import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { DeleteAttachmentDialog } from "@/components/chat/dialogs/delete-attachment";

import { deletedAttachmentName, singleViewerImage, viewerImages } from "@/stories/fixtures/attachments";
import { chat } from "@/stories/screens/chat";
import { imageViewer } from "@/stories/screens/chat-panels";

/**
 * チャット / 添付ファイル。
 *
 * story の id がそのまま docs/ui/screenshots/ の PNG のパスになる（`chat-attachment--…` ↔ `chat/attachment/….png`。ADR 0047 決定 2）。
 * title は日本語にできるが、id は PNG のパスに合わせて固定する。
 */
const meta = {
  title: "チャット/添付ファイル",
  // PNG のパス（chat/attachment/）と対応させる。title を日本語にしているので、id は自動生成に任せない。
  id: "chat-attachment",
  // この tag が「docs/ui/screenshots/ の PNG と 1 対 1 の画面」の印。撮影ツールと 1 対 1 の検査がこれで選ぶ。
  tags: ["screenshot"],
  // 画面を見るための story で、引数をいじる想定がないので下のパネルは出さない。
  // screenshot はこの tag と対で「撮影の対象」を表す。既定は実装から撮ったもの（story ごとに上書きする）。
  parameters: { options: { showPanel: false }, screenshot: { source: "app" } },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const AttachmentUploading: Story = {
  name: "添付: アップロード中",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () =>
    chat({ attachments: [{ id: "up-1", fileName: "サイドバー改訂.fig", status: "uploading", progress: 62 }] }),
};

export const AttachmentFailed: Story = {
  name: "添付: 失敗",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () => chat({ attachments: [{ id: "up-1", fileName: "サイドバー改訂.fig", status: "failed" }] }),
};

export const AttachmentDone: Story = {
  name: "添付: 完了",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () =>
    chat({ attachments: [{ id: "up-1", fileName: "サイドバー改訂.fig", status: "uploaded", sizeLabel: "1.8 MB" }] }),
};

export const ImageViewer: Story = {
  name: "画像の拡大表示",
  tags: ["since:6.7.5"],
  render: () => chat({ messageAttachments: "images", dialog: imageViewer(viewerImages, 1) }),
};

export const ImageViewerDark: Story = {
  name: "画像の拡大表示（ダーク）",
  tags: ["since:6.7.5"],
  parameters: { theme: "dark" },
  render: () => chat({ dark: true, messageAttachments: "images", dialog: imageViewer(viewerImages, 1) }),
};

// 最後の画像。送れる向きにだけ矢印を出す（端では出さない）
// 最後の画像。送れる向きにだけ矢印を出す（端では出さない）
export const ImageViewerLast: Story = {
  name: "画像の拡大表示: 最後の 1 枚",
  tags: ["since:6.7.5"],
  render: () => chat({ messageAttachments: "images", dialog: imageViewer(viewerImages, viewerImages.length - 1) }),
};

// 1 枚しかないので矢印と枚数を出さない。消せない人なので、削除も出ない（ADR 0045 決定 9）
// 1 枚しかないので矢印と枚数を出さない。消せない人なので、削除も出ない（ADR 0045 決定 9）
export const ImageViewerSingle: Story = {
  name: "画像の拡大表示: 1 枚だけ",
  tags: ["since:6.7.5"],
  render: () => chat({ messageAttachments: "images", dialog: imageViewer([singleViewerImage], 0, false) }),
};

export const AttachmentMenu: Story = {
  name: "添付ファイルの操作メニュー",
  tags: ["since:6.7.5"],
  render: () => chat({ messageAttachments: "menu" }),
};

export const AttachmentDeleteDialog: Story = {
  name: "添付ファイルの削除",
  tags: ["since:6.7.5"],
  render: () =>
    chat({
      messageAttachments: "images",
      dialog: (
        <>
          {imageViewer(viewerImages, 1)}
          <DeleteAttachmentDialog open fileName={deletedAttachmentName} />
        </>
      ),
    }),
};

// 最後の 1 枚で、本文も空のメッセージ。消すとメッセージごと消えることを先に伝える（ADR 0045 決定 8）
// 最後の 1 枚で、本文も空のメッセージ。消すとメッセージごと消えることを先に伝える（ADR 0045 決定 8）
export const AttachmentDeleteDialogLast: Story = {
  name: "添付ファイルの削除: メッセージごと消える",
  tags: ["since:6.7.5"],
  render: () =>
    chat({
      messageAttachments: "images",
      dialog: (
        <>
          {imageViewer([singleViewerImage], 0)}
          <DeleteAttachmentDialog open alsoDeletesMessage fileName={singleViewerImage.fileName} />
        </>
      ),
    }),
};

export const MobileImageViewer: Story = {
  name: "画像の拡大表示（モバイル）",
  tags: ["since:6.7.5"],
  parameters: { screenshot: { size: "390x844" } },
  globals: { viewport: { value: "mobile" } },
  render: () => chat({ messageAttachments: "images", dialog: imageViewer(viewerImages, 1) }),
};
