import type {
  AttachmentDraftView,
  LinkPreviewView,
  MessageAttachmentView,
  MessageLinkCardView,
  MessageReactionView,
} from "@/components/chat/types";
import type {
  LinkPreview,
  Mention,
  Message,
  MessageAttachment,
  MessageLink,
  MessageReaction,
  UserProfile,
} from "@/lib/api/types.gen";
import { clampCardBody, findPermalinks, linkKey, type Permalink, permalinkPath } from "@/lib/chat/format/links";
import { formatBytes, formatTime } from "@/lib/chat/format/time";
import type { LinkPreviewRef, MediaState } from "@/lib/chat/media/media-store";
import type { AttachmentDraft } from "@/lib/chat/media/uploads";

/**
 * メッセージ 1 件の表示用の値（本文の文言・添付・リアクション・リンクのカード）。
 * タイムラインにも、ピン留め・「後で」・アクティビティの一覧にも使う。
 */
/** 署名付き URL の手元の表（media.ts）。undefined と null は、どちらも画像を出さない。 */
export type UrlTable = Readonly<Record<string, string | null | undefined>>;

/**
 * API のレスポンスを、presentational コンポーネントの表示用の型に変える（ADR 0018）。
 * どれも純粋な関数にして、時刻の文言はタイムゾーンを引数で固定してテストする。
 */

/**
 * システムメッセージの文言（ADR 0033）。サーバーは種類と、そのときの名前だけを返す（`body` は空）。
 * 主語は sender（参加した人、名前を変えた人）。
 */
export function systemMessageText(message: Pick<Message, "sender" | "system">): string {
  const name = message.sender.display_name;
  switch (message.system?.type) {
    case "room_created":
      return `${name} がこのチャンネルを作成しました`;
    case "member_joined":
      return `${name} がチャンネルに参加しました`;
    case "member_left":
      return `${name} がチャンネルを退出しました`;
    case "member_removed":
      return `${name} がチャンネルから外されました`;
    case "room_renamed":
      return `${name} がチャンネル名を ${message.system.old_name} から ${message.system.new_name} に変更しました`;
    case "room_archived":
      return `${name} がチャンネルをアーカイブしました`;
    case "room_unarchived":
      return `${name} がチャンネルを復元しました`;
    case "huddle":
      // サイドバーの最終メッセージの 1 行。会話の中はハドルの行（views/huddles.ts）で描く（ADR 0066 決定 12）
      return `${name} がハドルミーティングを開始しました`;
    case "message_pinned":
      // いまは書かれない（ADR 0054 決定 3 の追記）。改める前に書かれた行のための文言
      return `${name} がこのチャンネルにメッセージをピン留めしました`;
    default:
      // 知らない種類（サーバーが先に増えた）。行を落とすより、何かが起きたことだけ出す
      return `${name} がチャンネルを更新しました`;
  }
}

/** 削除済みのメッセージの本文の代わり。タイムラインの表示（MessageItem）と同じ文言にする。 */
export const DELETED_MESSAGE_TEXT = "このメッセージは削除されました";

/**
 * 添付だけのメッセージ（本文が空）の、サイドバーでの 1 行。表示はデザインにない（docs/ui/README.md の未解決）ので仮の文言。
 * ルーム一覧の last_message には添付の情報がないので、ファイル名は出せない。
 */
export const ATTACHMENT_ONLY_TEXT = "添付ファイル";

/**
 * ブラウザが inline で返す画像（ADR 0013）。それ以外の image/*（SVG など）はダウンロードさせるので、ファイルとして出す。
 */
const INLINE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export function isPreviewImage(attachment: Pick<MessageAttachment, "content_type">): boolean {
  return INLINE_IMAGE_TYPES.has(attachment.content_type);
}

/**
 * 画面に出している（削除されていない）メッセージの、プレビューする画像の ID。GET URL を取る対象（media.ts）。
 * 送信中のメッセージの添付はまだメッセージに付いていない（URL が 404 になる）ので含めない。
 */
export function previewImageIds(messages: readonly Message[]): string[] {
  return messages.flatMap((m) =>
    m.deleted_at === null ? m.attachments.filter(isPreviewImage).map((a) => a.id) : [],
  );
}

/**
 * 画面に出している（削除されていない）メッセージの、画像かアイコンのあるリンクのプレビュー（ADR 0065）。
 * 署名付き URL を取る対象（media-store.ts）。どちらもないプレビューは取りに行かない。
 */
export function linkPreviewRefs(messages: readonly Message[]): LinkPreviewRef[] {
  return messages.flatMap((m) =>
    m.deleted_at === null
      ? m.link_previews
          .filter((p) => p.image !== null || p.has_icon)
          .map((p) => ({ roomId: m.room_id, messageId: m.id, previewId: p.id }))
      : [],
  );
}

/**
 * リンクのプレビューを、カードの表示用の型に変える（ADR 0065）。
 * 画像とアイコンの URL が取れるまでは、寸法から枠だけを出す（URL を空にする）。
 */
export function toLinkPreviewViews(
  previews: readonly LinkPreview[],
  urls: MediaState["linkPreviews"],
): LinkPreviewView[] {
  return previews.map((p) => {
    const signed = urls[p.id];
    return {
      id: p.id,
      url: p.url,
      siteName: p.site_name,
      ...(p.title === "" ? {} : { title: p.title }),
      ...(p.description === "" ? {} : { description: p.description }),
      ...(p.image === null ? {} : { image: { width: p.image.width, height: p.image.height, url: signed?.image ?? undefined } }),
      hasIcon: p.has_icon,
      ...(signed?.icon ? { iconUrl: signed.icon } : {}),
    };
  });
}

/**
 * 画面に出すメッセージの本文から、パーマリンクを集める（ADR 0040）。
 * 削除したメッセージの本文は空なので、自然に対象から外れる。
 */
export function permalinksIn(messages: readonly Message[], origin: string): Permalink[] {
  const found = new Map<string, Permalink>();
  for (const m of messages) {
    if (m.deleted_at !== null) continue;
    for (const link of findPermalinks(m.body, origin)) found.set(linkKey(link), link);
  }
  return [...found.values()];
}

/**
 * 本文に貼られたパーマリンクを、カードの表示用の型に変える（ADR 0040）。
 *
 * まだ取れていないリンクは loading。読めない・存在しない・**削除済み**はすべて unavailable にする
 * （削除は跡も残さず消える。ADR 0038。オーナーの確認: 2026-09-19）。
 */
export function toLinkCardViews(
  body: string,
  {
    origin,
    linkCards,
    currentWorkspaceId,
    avatarUrls,
    timeZone,
    mentionNames,
  }: {
    origin: string;
    linkCards: Record<string, MessageLink | undefined>;
    currentWorkspaceId?: string;
    avatarUrls: UrlTable;
    timeZone?: string;
    mentionNames?: Readonly<Record<string, string>>;
  },
): MessageLinkCardView[] | undefined {
  const links = findPermalinks(body, origin);
  if (links.length === 0) return undefined;

  return links.map((link): MessageLinkCardView => {
    const key = linkKey(link);
    const card = linkCards[key];
    if (card === undefined) return { key, state: "loading" };
    // 削除済みも読めないリンクと同じ見え方にする（ADR 0040）。
    if (card.status !== "ok" || !card.message || !card.room || card.message.deleted_at !== null) {
      return { key, state: "unavailable" };
    }
    const { message, room, workspace } = card;
    const clamped = clampCardBody(message.body);
    return {
      key,
      state: "ok",
      href: permalinkPath({
        workspaceId: workspace?.id ?? link.workspaceId,
        roomId: room.id,
        messageId: message.id,
        ...(message.thread_root_id !== null ? { threadRootId: message.thread_root_id } : {}),
      }),
      // 同じワークスペースならいつも同じ名前が並ぶだけなので出さない。
      ...(workspace && workspace.id !== currentWorkspaceId ? { workspaceName: workspace.name } : {}),
      // dm にはルーム名がないので、相手の名前を出す（サイドバーと同じ扱い）。
      room: { kind: room.kind, name: room.kind === "dm" ? (room.dm_peer?.display_name ?? "ダイレクトメッセージ") : room.name },
      sender: {
        id: message.sender.id,
        name: message.sender.display_name,
        avatarUrl: avatarUrls[message.sender.id] ?? undefined,
      },
      timeLabel: formatTime(new Date(message.created_at), timeZone),
      body: message.body,
      mentionNames,
      clampedBody: clamped.text,
      clamped: clamped.clamped,
      attachmentCount: message.attachment_count,
      inThread: message.thread_root_id !== null,
    };
  });
}

export function toAttachmentView(attachment: MessageAttachment, urls: UrlTable): MessageAttachmentView {
  if (isPreviewImage(attachment)) {
    return {
      kind: "image",
      id: attachment.id,
      fileName: attachment.file_name,
      width: attachment.width ?? undefined,
      height: attachment.height ?? undefined,
      url: urls[attachment.id] ?? undefined,
    };
  }
  return { kind: "file", id: attachment.id, fileName: attachment.file_name, sizeLabel: formatBytes(attachment.size_bytes) };
}

/**
 * リアクションを表示用にする（ADR 0044）。`users`（先頭 8 人までの ID）をルームのメンバーの表示名に直す。
 * 引けない ID（ルームを抜けた人）は落とす。数は count のままなので、ホバーでは「他 N 人」に混ざる。
 *
 * `me` は WebSocket の配信に載らないので undefined のことがある。そのときは false として描く
 * （手元の値を引き継ぐのはデータ層の mergeMessages の仕事。ADR 0044）。
 */
export function toReactionViews(
  reactions: readonly MessageReaction[],
  memberNames: Readonly<Record<string, string>> | undefined,
  me: UserProfile | undefined,
): MessageReactionView[] {
  return reactions.map((r) => ({
    emoji: r.emoji,
    count: r.count,
    me: r.me ?? false,
    names: r.users.flatMap((id) => {
      if (me !== undefined && id === me.id) return ["あなた"];
      const name = memberNames?.[id];
      return name === undefined ? [] : [name];
    }),
  }));
}

/** 自分宛てか。`@channel` / `@here` も自分宛てに数える（ADR 0041）。 */
export function mentionsUser(mentions: readonly Mention[], userId: string): boolean {
  return mentions.some((m) => (m.kind === "user" ? m.user?.id === userId : true));
}

/** 入力欄に並べる添付。 */
export function toAttachmentDraftView(draft: AttachmentDraft): AttachmentDraftView {
  switch (draft.status) {
    case "uploading":
      return { id: draft.key, fileName: draft.fileName, status: "uploading", progress: draft.progress };
    case "failed":
      return { id: draft.key, fileName: draft.fileName, status: "failed" };
    case "uploaded":
      return { id: draft.key, fileName: draft.fileName, status: "uploaded", sizeLabel: formatBytes(draft.file.size) };
  }
}
