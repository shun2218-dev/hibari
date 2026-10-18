import type { LinkPreviewURLs, PreviewLinkResponse } from "@/lib/api/types.gen";
import type { Session } from "@/lib/auth/session/auth-session";

/**
 * 外部のリンクのプレビュー（ADR 0065）。画像とアイコンの中身はサーバーを通さず、署名付き URL で読む。
 */
export function createLinkPreviewApi(request: Session["request"]) {
  const messagePath = (roomId: string, messageId: string, previewId: string) =>
    `/api/v1/rooms/${encodeURIComponent(roomId)}/messages/${encodeURIComponent(messageId)}/link-previews/${encodeURIComponent(previewId)}`;
  return {
    /**
     * 入力欄のプレビューを取る（決定 13）。サーバーがその場で取りに行くので、最大 10 秒ほど待つ。
     * カードにならなければ preview が null（理由は区別されない）。
     */
    previewLink: (roomId: string, url: string) =>
      request<PreviewLinkResponse>("POST", `/api/v1/rooms/${encodeURIComponent(roomId)}/link-previews`, { url }),

    /** メッセージに付いたプレビューの画像とアイコンの署名付き GET URL（5 分。決定 7）。 */
    linkPreviewUrls: (roomId: string, messageId: string, previewId: string) =>
      request<LinkPreviewURLs>("GET", `${messagePath(roomId, messageId, previewId)}/urls`),

    /** 本人がプレビューを消す（決定 5）。冪等で、本文はない（204）。ほかの人には message.updated で届く。 */
    removeLinkPreview: (roomId: string, messageId: string, previewId: string) =>
      request<void>("DELETE", messagePath(roomId, messageId, previewId)),
  };
}
