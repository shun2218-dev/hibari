import type { MessageAttachmentView, TimelineItem } from "@/components/chat/types";

import { timeline } from "./timeline";

/**
 * 添付と拡大表示（ADR 0013 / 0045）。
 */
// ---- 添付ファイルの拡大表示と削除（ADR 0045）----

/**
 * 拡大表示に出すモックの画像（public/dev/）。本物は署名付き URL（ADR 0028）で、ここでは静的なファイルで代用する。
 * 寸法は実物と同じ値を入れてあるので、タイムラインの枠も読み込み前から正しい大きさになる（ADR 0013）。
 */
export const imageAttachments: MessageAttachmentView[] = [
  { kind: "image", id: "a-3", fileName: "サイドバー改訂 01.png", url: "/dev/photo-1.png", width: 1200, height: 800 },
  { kind: "image", id: "a-4", fileName: "サイドバー改訂 02.png", url: "/dev/photo-2.png", width: 1200, height: 800 },
  { kind: "image", id: "a-5", fileName: "サイドバー改訂 03.png", url: "/dev/photo-3.png", width: 1200, height: 800 },
];

/** 1 枚だけ付いているメッセージの画像（縦長。拡大表示で上下に余白が出る）。 */
export const singleImageAttachment: MessageAttachmentView = {
  kind: "image",
  id: "a-6",
  fileName: "未読バッジの候補.png",
  url: "/dev/photo-4.png",
  width: 800,
  height: 1200,
};

/** 画像とファイルを付けたメッセージの key（拡大表示とファイルのメニューの画面で使う）。 */
export const attachmentMessageKey = "m-1041";

/**
 * 画像 3 枚とファイル 1 件を付けたタイムライン（chat/attachment/image-viewer.png、chat/attachment/attachment-menu.png）。
 * 1 枚だけの画像は、上のメッセージ（m-1402）をモックの画像に差し替えて出す。
 */
export const timelineWithImages: TimelineItem[] = timeline.map((item) => {
  if (item.type !== "message") return item;
  if (item.message.key === attachmentMessageKey) {
    return { type: "message", message: { ...item.message, attachments: [...item.message.attachments, ...imageAttachments] } };
  }
  if (item.message.key === "m-1402") {
    return { type: "message", message: { ...item.message, attachments: [singleImageAttachment] } };
  }
  return item;
});

/** 拡大表示に渡す画像（そのメッセージのインライン表示の画像だけ。ADR 0045 決定 2）。 */
export const viewerImages = imageAttachments.map((attachment) => ({
  id: attachment.id,
  fileName: attachment.fileName,
  url: attachment.kind === "image" ? attachment.url : undefined,
}));

/** 1 枚だけの画像を開いたときに拡大表示に渡すもの（送る導線が出ない）。 */
export const singleViewerImage = {
  id: singleImageAttachment.id,
  fileName: singleImageAttachment.fileName,
  url: singleImageAttachment.kind === "image" ? singleImageAttachment.url : undefined,
};

/** 拡大表示から削除するときのファイル名（chat/attachment/attachment-delete-dialog.png）。 */
export const deletedAttachmentName = imageAttachments[1].fileName;
