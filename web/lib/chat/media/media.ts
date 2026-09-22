import { ApiError } from "@/lib/api/error";

import { AVATAR_BATCH_SIZE, type ChatApi } from "@/lib/chat/api";

/**
 * 画面に出す画像の署名付き GET URL（アバターと、メッセージに付いた画像）。
 *
 * どちらも chat のレスポンスには URL が載らない（ADR 0013 / 0020）ので、画面に出すものの ID を集めて引く。
 * - undefined: まだ取っていない（取得中を含む）
 * - null: 出す画像がない（アバターを設定していない、添付が読めない・読み込みに失敗した）
 * - string: 署名付き URL
 *
 * どちらも読み込めなければ代わりの表示（頭文字、ファイル名の枠）があるので、失敗を画面には出さない。
 */
export type MediaState = {
  avatars: Record<string, string | null | undefined>;
  attachments: Record<string, string | null | undefined>;
};

export type MediaStoreOptions = { now?: () => number };

/**
 * アバターの URL は、有効期限（1 時間）がこの時間を切っていたら、次に頼まれたときに取り直す。
 * 画像がない人も同じ間隔で確かめ直す（あとから設定されることがある）。
 */
const AVATAR_REFRESH_MARGIN_MS = 5 * 60 * 1000;
const AVATAR_NONE_TTL_MS = 60 * 60 * 1000;

/**
 * 添付の画像が読み込めなかったとき、URL を取ってからこの時間が過ぎていれば、期限切れとみなして取り直す。
 * それより早く失敗したなら、取り直しても同じなので諦める（取り直しと失敗を繰り返さない）。
 */
const ATTACHMENT_RETRY_AFTER_MS = 60 * 1000;

/**
 * アバターと添付の画像の URL を持つストア（chat のストアと同じく、useSyncExternalStore で購読する）。
 *
 * 取り直し方を 2 つで変えている（ADR 0028）。
 * - アバター: 頼まれたときに期限を見て取り直す。小さい画像なので、URL が変わって読み込み直しても害が小さい
 * - 添付: まだないときだけ取り、読み込みに失敗したら取り直す。最大 25 MiB あり、表示できている画像の URL を替えて読み込み直させない
 */
export function createMediaStore(api: ChatApi, { now = Date.now }: MediaStoreOptions = {}) {
  let state: MediaState = { avatars: {}, attachments: {} };
  const listeners = new Set<() => void>();

  // アバター: 取り直す時刻（手元の時計）と、次のまとめた取得を待っている ID・取得中の ID
  const avatarRefreshAt = new Map<string, number>();
  const avatarQueue = new Set<string>();
  const avatarInflight = new Set<string>();
  let avatarFlushScheduled = false;

  // 添付: URL を取った時刻（手元の時計）と、取得中の ID
  const attachmentFetchedAt = new Map<string, number>();
  const attachmentInflight = new Set<string>();

  function update(recipe: (s: MediaState) => MediaState) {
    const next = recipe(state);
    if (next === state) return;
    state = next;
    for (const listener of listeners) listener();
  }

  // ---- アバター ----

  async function fetchAvatars(userIds: string[]) {
    for (const id of userIds) avatarInflight.add(id);
    try {
      const { avatars } = await api.avatarUrls(userIds);
      const fetchedAt = now();
      update((s) => {
        const next = { ...s.avatars };
        for (const id of userIds) {
          const signed = avatars[id];
          next[id] = signed?.url ?? null;
          // 期限はサーバーの時計で返るが、手元の時計とずれていても余裕（5 分）の中に収まる前提で使う
          const expiresAt = signed ? Date.parse(signed.expires_at) : fetchedAt + AVATAR_NONE_TTL_MS;
          avatarRefreshAt.set(id, expiresAt - AVATAR_REFRESH_MARGIN_MS);
        }
        return { ...s, avatars: next };
      });
    } catch (err) {
      // 頭文字のまま出しておく。次に頼まれたときに取り直す
      console.error("failed to load avatar urls", err);
    } finally {
      for (const id of userIds) avatarInflight.delete(id);
    }
  }

  function flushAvatars() {
    avatarFlushScheduled = false;
    const ids = [...avatarQueue];
    avatarQueue.clear();
    for (let i = 0; i < ids.length; i += AVATAR_BATCH_SIZE) {
      void fetchAvatars(ids.slice(i, i + AVATAR_BATCH_SIZE));
    }
  }

  // ---- 添付 ----

  async function fetchAttachmentUrl(attachmentId: string) {
    attachmentInflight.add(attachmentId);
    try {
      const { url } = await api.getAttachmentUrl(attachmentId);
      attachmentFetchedAt.set(attachmentId, now());
      update((s) => ({ ...s, attachments: { ...s.attachments, [attachmentId]: url } }));
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        // 読めなくなった（メッセージが削除された、ルームから外された）。ファイル名の枠のままにする
        update((s) => ({ ...s, attachments: { ...s.attachments, [attachmentId]: null } }));
      } else {
        console.error("failed to load an attachment url", err);
      }
    } finally {
      attachmentInflight.delete(attachmentId);
    }
  }

  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    getSnapshot(): MediaState {
      return state;
    },

    /**
     * 画面に出すユーザーのアバターの URL を頼む。まだ取っていない人と、期限が近い人の分だけ取る。
     * 同じ描画の中で複数の画面（サイドバー、タイムライン、メンバー）から頼まれても 1 回にまとめて送る。
     */
    requestAvatars(userIds: readonly string[]) {
      const current = now();
      for (const id of userIds) {
        if (avatarInflight.has(id)) continue;
        const refreshAt = avatarRefreshAt.get(id);
        if (state.avatars[id] !== undefined && refreshAt !== undefined && refreshAt > current) continue;
        avatarQueue.add(id);
      }
      if (avatarQueue.size === 0 || avatarFlushScheduled) return;
      avatarFlushScheduled = true;
      queueMicrotask(flushAvatars);
    },

    /** メッセージに付いた画像の URL を頼む。まだ取っていないものだけを取る。 */
    requestAttachmentUrls(attachmentIds: readonly string[]) {
      for (const id of attachmentIds) {
        if (state.attachments[id] !== undefined || attachmentInflight.has(id)) continue;
        void fetchAttachmentUrl(id);
      }
    },

    /**
     * 画像が読み込めなかった。URL を取ってから時間が経っていれば期限切れとみなして取り直し、そうでなければ諦める。
     * url は読み込みに使った URL。すでに取り直した後に古い URL の失敗が届いたら、何もしない。
     */
    attachmentImageFailed(attachmentId: string, url: string) {
      if (state.attachments[attachmentId] !== url || attachmentInflight.has(attachmentId)) return;
      const fetchedAt = attachmentFetchedAt.get(attachmentId) ?? 0;
      if (now() - fetchedAt >= ATTACHMENT_RETRY_AFTER_MS) {
        void fetchAttachmentUrl(attachmentId);
      } else {
        update((s) => ({ ...s, attachments: { ...s.attachments, [attachmentId]: null } }));
      }
    },

    /**
     * ダウンロードに使う URL。手元の URL は期限が近いかもしれないので、押されるたびに取る。
     * 失敗したら ApiError を投げる。
     */
    async attachmentDownloadUrl(attachmentId: string): Promise<string> {
      return (await api.getAttachmentUrl(attachmentId)).url;
    },
  };
}

export type MediaStore = ReturnType<typeof createMediaStore>;
