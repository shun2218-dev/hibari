import { ApiError } from "@/lib/api/error";
import type { CreateAttachmentResponse, MessageAttachment } from "@/lib/api/types.gen";

import type { ChatApi } from "@/lib/chat/api/chat-api";
import { type PutFile, UploadAbortedError, putFileWithXhr } from "./put-file";

/** 1 メッセージに付けられる添付の数（ADR 0013）。 */
export const MAX_ATTACHMENTS = 10;

/**
 * 入力欄に並べている添付。
 * - uploading: URL の発行 → PUT → complete（HEAD での検証）の途中。progress は PUT の進み具合（0〜100）
 * - failed: どこかで失敗した。再試行は発行からやり直す
 * - uploaded: メッセージに付けられる（サーバーでは uploaded）
 */
export type AttachmentDraft = {
  key: string;
  file: File;
  fileName: string;
  status: "uploading" | "failed" | "uploaded";
  progress: number;
  /** uploaded のときだけある。送信中のメッセージの表示にも使う。 */
  attachment: MessageAttachment | null;
};

export type ImageSize = (file: File) => Promise<{ width: number; height: number } | undefined>;

export type UploaderOptions = {
  putFile?: PutFile;
  imageSize?: ImageSize;
};

/** ブラウザが inline で表示する画像（ADR 0013）。寸法を申告して、読み込む前にプレビューの枠を確保する。 */
const PREVIEW_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

const OCTET_STREAM = "application/octet-stream";

/** サーバーの Content-Type の検証（小文字、パラメータなし）に通る形。 */
const MEDIA_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;

const MAX_FILE_NAME_LENGTH = 255;
const MAX_IMAGE_SIDE = 65535;

/**
 * サーバーが受け付けないファイル名（`/`・`\`・制御文字、255 文字超。ADR 0013）を、送れる形に直す。
 * ファイル名は表示とダウンロード時の名前にしか使わないので、弾いてアップロードを失敗させるより、置き換えて通す。
 */
export function uploadFileName(name: string): string {
  const replaced = name.replace(/[/\\\u0000-\u001f\u007f-\u009f]/g, "_");
  return Array.from(replaced).slice(0, MAX_FILE_NAME_LENGTH).join("");
}

/**
 * 申告する Content-Type。ブラウザが種類を判定できなかった（空）・形が違うファイルは application/octet-stream にする。
 * 種類の分からないファイルも添付できる（ADR 0013）。
 */
export function uploadContentType(file: File): string {
  return MEDIA_TYPE.test(file.type) ? file.type : OCTET_STREAM;
}

/** 画像の寸法を読む。読めなければ（壊れた画像、対応していない環境）申告しない。 */
export const readImageSize: ImageSize = async (file) => {
  if (typeof createImageBitmap !== "function") return undefined;
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return undefined;
  }
};

function isRejectedContentType(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    err.status === 422 &&
    err.fieldErrors.some((e) => e.field === "content_type" && e.reason === "invalid_value")
  );
}

/**
 * 1 つのルームの入力欄に並べる添付のアップロード。ルームの画面を開いている間だけ持つ（入力欄の本文と同じく、ルームを移ると消える）。
 *
 * 流れは「URL の発行 → ストレージに PUT → complete」（ADR 0013）。中身はサーバーを経由しない。
 * 取り消したものは、PUT を打ち切り、それ以降の結果を捨てる。サーバーに残った pending / uploaded の行は、掃除ジョブが 24 時間後に消す。
 */
export function createAttachmentUploader(
  api: Pick<ChatApi, "createAttachment" | "completeAttachment">,
  roomId: string,
  { putFile = putFileWithXhr, imageSize = readImageSize }: UploaderOptions = {},
) {
  let drafts: AttachmentDraft[] = [];
  const listeners = new Set<() => void>();
  // 進行中のアップロードの打ち切り。キーが消えていれば、取り消されたので結果を捨てる
  const running = new Map<string, AbortController>();
  let nextKey = 0;

  function set(next: AttachmentDraft[]) {
    drafts = next;
    for (const listener of listeners) listener();
  }

  function patch(key: string, change: Partial<AttachmentDraft>) {
    if (!drafts.some((d) => d.key === key)) return;
    set(drafts.map((d) => (d.key === key ? { ...d, ...change } : d)));
  }

  async function upload(draft: AttachmentDraft) {
    const controller = new AbortController();
    running.set(draft.key, controller);
    const current = () => running.get(draft.key) === controller;
    try {
      const { file } = draft;
      let contentType = uploadContentType(file);
      const size = PREVIEW_IMAGE_TYPES.has(contentType) ? await imageSize(file) : undefined;
      const dimensions =
        size && size.width >= 1 && size.height >= 1 && size.width <= MAX_IMAGE_SIDE && size.height <= MAX_IMAGE_SIDE
          ? { width: size.width, height: size.height }
          : {};
      const create = (type: string) =>
        api.createAttachment(roomId, {
          file_name: draft.fileName,
          content_type: type,
          size_bytes: file.size,
          ...(PREVIEW_IMAGE_TYPES.has(type) ? dimensions : {}),
        });

      let created: CreateAttachmentResponse;
      try {
        created = await create(contentType);
      } catch (err) {
        // サーバーの許可リストにない種類（ATTACHMENT_ALLOWED_TYPES）。種類の分からないファイルとして送り直す
        if (!isRejectedContentType(err) || contentType === OCTET_STREAM) throw err;
        contentType = OCTET_STREAM;
        created = await create(contentType);
      }
      if (!current()) return;

      await putFile(created.upload.url, created.upload.headers, file, {
        signal: controller.signal,
        onProgress: (ratio) => {
          if (current()) patch(draft.key, { progress: Math.min(100, Math.floor(ratio * 100)) });
        },
      });
      if (!current()) return;

      const completed = await api.completeAttachment(created.attachment.id);
      if (!current()) return;
      patch(draft.key, {
        status: "uploaded",
        progress: 100,
        attachment: {
          id: completed.id,
          file_name: completed.file_name,
          content_type: completed.content_type,
          size_bytes: completed.size_bytes,
          width: completed.width,
          height: completed.height,
        },
      });
    } catch (err) {
      if (!current()) return;
      // 失敗の理由（大きすぎる、種類が許可されていない、期限切れ）の表示はデザインにない（docs/ui/README.md の未解決）
      if (!(err instanceof UploadAbortedError)) console.error("failed to upload an attachment", err);
      patch(draft.key, { status: "failed" });
    } finally {
      if (current()) running.delete(draft.key);
    }
  }

  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    getSnapshot(): AttachmentDraft[] {
      return drafts;
    },

    /** 選んだファイルを並べて、アップロードを始める。上限（10 個）を超えた分は足さない。 */
    add(files: readonly File[]) {
      const room = MAX_ATTACHMENTS - drafts.length;
      if (room <= 0) return;
      const added = files.slice(0, room).map(
        (file): AttachmentDraft => ({
          key: `draft-${++nextKey}`,
          file,
          fileName: uploadFileName(file.name),
          status: "uploading",
          progress: 0,
          attachment: null,
        }),
      );
      if (added.length === 0) return;
      set([...drafts, ...added]);
      for (const draft of added) void upload(draft);
    },

    /** 失敗したものを、URL の発行からやり直す（前の行は使わない。掃除ジョブが消す）。 */
    retry(key: string) {
      const draft = drafts.find((d) => d.key === key);
      if (draft?.status !== "failed") return;
      const next: AttachmentDraft = { ...draft, status: "uploading", progress: 0, attachment: null };
      set(drafts.map((d) => (d.key === key ? next : d)));
      void upload(next);
    },

    /** 入力欄から外す。アップロード中なら打ち切る。 */
    remove(key: string) {
      running.get(key)?.abort();
      running.delete(key);
      if (drafts.some((d) => d.key === key)) set(drafts.filter((d) => d.key !== key));
    },

    /** 送信に使う添付を取り出して、入力欄を空にする。全部 uploaded のときだけ呼ぶ。 */
    take(): MessageAttachment[] {
      const attachments = drafts.flatMap((d) => (d.attachment ? [d.attachment] : []));
      if (drafts.length > 0) set([]);
      return attachments;
    },

    /** 画面を離れる。進行中のアップロードを打ち切り、並べていたものを捨てる。 */
    abortAll() {
      for (const controller of running.values()) controller.abort();
      running.clear();
      if (drafts.length > 0) set([]);
    },
  };
}

export type AttachmentUploader = ReturnType<typeof createAttachmentUploader>;

/** 送信できる状態か。アップロード中と失敗したものが残っていたら送らない（付けたつもりの添付が抜けないように）。 */
export function draftsReady(drafts: readonly AttachmentDraft[]): boolean {
  return drafts.every((d) => d.status === "uploaded");
}
