import type {
  Attachment,
  AvatarURLs,
  CreateAttachmentRequest,
  CreateAttachmentResponse,
  Message,
  SignedURL,
} from "@/lib/api/types.gen";
import type { Session } from "@/lib/auth/session/auth-session";

/** アバターの URL を 1 回で取れる人数。API の上限（ADR 0020）。 */
export const AVATAR_BATCH_SIZE = 200;

/**
 * 添付とアバターの署名付き URL（中身は Go サーバーを通さない。ADR 0013 / 0020 / 0028）。
 */
export function createMediaApi(request: Session["request"]) {
  return {
    /** 添付の署名付き PUT URL を発行する。pending の行ができる（ADR 0013）。 */
    createAttachment: (roomId: string, body: CreateAttachmentRequest) =>
      request<CreateAttachmentResponse>("POST", `/api/v1/rooms/${encodeURIComponent(roomId)}/attachments`, body),

    /** PUT したオブジェクトを HEAD で検証し、メッセージに付けられる状態（uploaded）にする。冪等。 */
    completeAttachment: (attachmentId: string) =>
      request<Attachment>("POST", `/api/v1/attachments/${encodeURIComponent(attachmentId)}/complete`),

    /**
     * 添付ファイルだけを削除する（ADR 0045）。冪等で、更新後のメッセージを返す。
     * 最後の 1 件で本文も空だったメッセージは、ここで tombstone になる（決定 8）。
     */
    deleteMessageAttachment: (roomId: string, messageId: string, attachmentId: string) =>
      request<Message>(
        "DELETE",
        `/api/v1/rooms/${encodeURIComponent(roomId)}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
      ),

    /** メッセージに付いた添付の署名付き GET URL（TTL 5 分。ADR 0013）。 */
    getAttachmentUrl: (attachmentId: string) =>
      request<SignedURL>("GET", `/api/v1/attachments/${encodeURIComponent(attachmentId)}/url`),

    /**
     * アバターの署名付き GET URL をまとめて取る（TTL 1 時間。ADR 0020）。画像がある人の分だけ返る。
     * パスは auth の API だが、chat のレスポンスに URL を載せない代わりに画面の側で引くので、ここに置く。
     */
    avatarUrls: (userIds: string[]) => request<AvatarURLs>("POST", "/api/v1/users/avatars", { user_ids: userIds }),
  };
}
