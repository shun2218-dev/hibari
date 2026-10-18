"use client";

import { type ReactNode, useState } from "react";

import { DeleteAttachmentDialog } from "@/components/chat/dialogs/delete-attachment";
import { ImageViewer } from "@/components/chat/image-viewer";
import { ApiError } from "@/lib/api/error";
import type { Message } from "@/lib/api/types.gen";
import { isPreviewImage } from "@/lib/chat/views/message";

import { useChatStore } from "./use-chat-store";
import { useMedia, useMediaState } from "./use-media";

/**
 * ブラウザにダウンロードさせる。GET URL は Content-Disposition: attachment で署名してある（ADR 0013）ので、
 * 開いてもページは移らずに保存が始まる。
 */
function startDownload(url: string) {
  const link = document.createElement("a");
  link.href = url;
  link.rel = "noopener";
  link.click();
}

/**
 * メッセージに付いた添付の操作（ADR 0013 / 0028 / 0045）。ダウンロード・画像の拡大表示・削除の確認。
 *
 * メッセージ本体の操作（useMessageActions）とは、開いているものを互いに閉じること以外の関わりがないので分けてある。
 * 拡大表示を開くときに「…」メニューを閉じるのは、呼ぶ側（useMessageActions）が行う。
 */
export function useMessageAttachments({
  roomId,
  findMessage,
  canDelete,
}: {
  roomId: string;
  /** 手元にあるメッセージを ID で引く。 */
  findMessage: (messageId: string) => Message | undefined;
  /** そのメッセージの添付を消せるか（判定はメッセージの削除と同じ。ADR 0045 決定 5）。 */
  canDelete: (messageId: string) => boolean;
}): {
  onDownload: (attachmentId: string) => void;
  /** 画像を拡大表示で開く。 */
  openImage: (messageId: string, attachmentId: string) => void;
  openAttachmentMenu: { key: string; attachmentId: string } | undefined;
  onToggleAttachmentMenu: (key: string, attachmentId: string) => void;
  onDeleteAttachment: (key: string, attachmentId: string) => void;
  /** 拡大表示と削除の確認。呼ぶ側はそのまま置く。 */
  overlays: ReactNode;
} {
  const store = useChatStore();
  const media = useMedia();
  // 拡大表示に出す画像の URL。タイムラインに出ている画像はすでに取ってある（ADR 0028 / 0045 決定 4）
  const attachmentUrls = useMediaState((s) => s.attachments);
  // 拡大表示で開いている画像（ADR 0045）。null なら開いていない
  const [viewing, setViewing] = useState<{ messageId: string; attachmentId: string } | null>(null);
  const [openAttachmentMenu, setOpenAttachmentMenu] = useState<{ key: string; attachmentId: string }>();
  const [deletingAttachment, setDeletingAttachment] = useState<{
    messageId: string;
    attachmentId: string;
    fileName: string;
    /** これが最後の添付で本文も空（消すとメッセージごと消える。ADR 0045 決定 8）。 */
    alsoDeletesMessage: boolean;
    pending: boolean;
  } | null>(null);

  /** そのメッセージの、インライン表示している画像だけ（送れる範囲。ADR 0045 決定 2）。並びは添付の順のまま。 */
  function imagesOf(messageId: string) {
    const message = findMessage(messageId);
    if (!message || message.deleted_at !== null) return [];
    return message.attachments
      .filter(isPreviewImage)
      .map((a) => ({ id: a.id, fileName: a.file_name, url: attachmentUrls[a.id] ?? undefined }));
  }

  const viewerImages = viewing ? imagesOf(viewing.messageId) : [];
  // 開いていた画像が無くなったら（ほかの人が消した、メッセージごと消えた、読めなくなった）、拡大表示も出さない。
  // 自分が消したときは、次の画像に送るか閉じるかを確定のときに決める（confirmDeleteAttachment）
  const viewerIndex = viewing ? viewerImages.findIndex((image) => image.id === viewing.attachmentId) : -1;

  /**
   * 添付の削除の確認を開く（ADR 0045 決定 9）。取り消せない操作なので、楽観的更新はしない。
   * 最後の 1 件で本文も空なら、メッセージごと消えることを先に伝える（決定 8）。
   */
  function askDeleteAttachment(key: string, attachmentId: string) {
    setOpenAttachmentMenu(undefined);
    const message = findMessage(key);
    const attachment = message?.attachments.find((a) => a.id === attachmentId);
    if (!message || !attachment) return;
    setDeletingAttachment({
      messageId: message.id,
      attachmentId,
      fileName: attachment.file_name,
      alsoDeletesMessage: message.attachments.length === 1 && message.body.trim() === "",
      pending: false,
    });
  }

  async function confirmDeleteAttachment() {
    if (!deletingAttachment) return;
    const { messageId, attachmentId } = deletingAttachment;
    // 拡大表示から消したときの送り先。次がなければ前、どちらもなければ閉じる（ADR 0045 の「結果」）
    const images = imagesOf(messageId);
    const at = images.findIndex((image) => image.id === attachmentId);
    const nextImage = images[at + 1] ?? images[at - 1];
    setDeletingAttachment({ ...deletingAttachment, pending: true });
    try {
      await store.deleteAttachment(roomId, messageId, attachmentId);
      if (viewing?.attachmentId === attachmentId) {
        setViewing(nextImage ? { messageId, attachmentId: nextImage.id } : null);
      }
      setDeletingAttachment(null);
    } catch (err) {
      // 失敗の表示はデザインにない。権限がない（403）・見つからない（404）なら閉じ、それ以外は押し直せるように戻す
      console.error("failed to delete an attachment", err);
      if (err instanceof ApiError && (err.status === 403 || err.status === 404)) setDeletingAttachment(null);
      else setDeletingAttachment((current) => current && { ...current, pending: false });
    }
  }

  /** 押されるたびに GET URL を取り直してダウンロードさせる（手元の URL は期限が近いかもしれない。ADR 0028）。 */
  async function download(attachmentId: string) {
    try {
      startDownload(await media.attachmentDownloadUrl(attachmentId));
    } catch (err) {
      // 失敗の表示はデザインにない
      console.error("failed to download an attachment", err);
    }
  }

  return {
    onDownload: (attachmentId) => void download(attachmentId),
    openImage: (messageId, attachmentId) => setViewing({ messageId, attachmentId }),
    openAttachmentMenu,
    onToggleAttachmentMenu: (key, attachmentId) =>
      setOpenAttachmentMenu((current) =>
        current?.key === key && current.attachmentId === attachmentId ? undefined : { key, attachmentId },
      ),
    onDeleteAttachment: askDeleteAttachment,
    overlays: (
      <>
        <DeleteAttachmentDialog
          open={deletingAttachment !== null}
          fileName={deletingAttachment?.fileName ?? ""}
          alsoDeletesMessage={deletingAttachment?.alsoDeletesMessage}
          pending={deletingAttachment?.pending}
          onCancel={() => setDeletingAttachment(null)}
          onConfirm={confirmDeleteAttachment}
        />
        {viewing !== null && viewerIndex >= 0 && (
          <ImageViewer
            images={viewerImages}
            index={viewerIndex}
            onMove={(next) => setViewing({ messageId: viewing.messageId, attachmentId: viewerImages[next].id })}
            onClose={() => setViewing(null)}
            onDownload={(attachmentId) => void download(attachmentId)}
            // 消せる人にだけ出す（判定はメッセージの削除と同じ。ADR 0045 決定 5）
            onDelete={
              canDelete(viewing.messageId)
                ? (attachmentId) => askDeleteAttachment(viewing.messageId, attachmentId)
                : undefined
            }
            onImageError={(id, url) => media.attachmentImageFailed(id, url)}
          />
        )}
      </>
    ),
  };
}
