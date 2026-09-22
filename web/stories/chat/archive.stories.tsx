import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { ArchiveRoomDialog, DeleteRoomDialog } from "@/components/chat/room-dialogs";

import { chat, roomSettingsDialog } from "../screens";

/**
 * チャット / アーカイブと削除（ADR 0059）。
 *
 * story の id がそのまま docs/ui/screenshots/ の PNG のパスになる（`chat-archive--…` ↔ `chat/archive/….png`。ADR 0047 決定 2）。
 */
const meta = {
  title: "チャット/アーカイブと削除",
  id: "chat-archive",
  tags: ["screenshot"],
  parameters: { options: { showPanel: false }, screenshot: { source: "app" } },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Room: Story = {
  name: "アーカイブしたチャンネル",
  tags: ["since:6.15"],
  render: () => chat({ footer: "archived" }),
};

export const RoomDark: Story = {
  name: "アーカイブしたチャンネル（ダーク）",
  tags: ["since:6.15"],
  parameters: { theme: "dark" },
  render: () => chat({ footer: "archived", dark: true }),
};

export const RoomReadonly: Story = {
  name: "アーカイブしたチャンネル（復元できない人）",
  tags: ["since:6.15"],
  render: () => chat({ footer: "archived-readonly" }),
};

export const MobileRoom: Story = {
  name: "アーカイブしたチャンネル（モバイル）",
  tags: ["since:6.15"],
  parameters: { screenshot: { size: "390x844" } },
  globals: { viewport: { value: "mobile" } },
  render: () => chat({ footer: "archived" }),
};

export const Search: Story = {
  name: "サイドバーの検索にアーカイブしたチャンネルが混ざる",
  tags: ["since:6.15"],
  render: () => chat({ search: "デザイン", archivedSearch: true }),
};

export const SettingsMember: Story = {
  name: "チャンネルの設定（member。アーカイブだけ）",
  tags: ["since:6.15"],
  render: () => chat({ dialog: roomSettingsDialog({ canEdit: false, archive: "member" }) }),
};

export const SettingsAdmin: Story = {
  name: "チャンネルの設定（admin。アーカイブと削除）",
  tags: ["since:6.15"],
  render: () => chat({ dialog: roomSettingsDialog({ canEdit: true, archive: "admin" }) }),
};

export const SettingsArchived: Story = {
  name: "チャンネルの設定（アーカイブ中。復元と削除）",
  tags: ["since:6.15"],
  render: () => chat({ footer: "archived", dialog: roomSettingsDialog({ canEdit: true, archive: "archived" }) }),
};

export const ArchiveDialog: Story = {
  name: "アーカイブの確認",
  tags: ["since:6.15"],
  render: () => chat({ dialog: <ArchiveRoomDialog open name="デザインレビュー" /> }),
};

export const DeleteDialog: Story = {
  name: "削除の確認",
  tags: ["since:6.15"],
  render: () => chat({ dialog: <DeleteRoomDialog open name="デザインレビュー" /> }),
};

export const DeleteDialogConfirmed: Story = {
  name: "削除の確認（チェックを入れたところ）",
  tags: ["since:6.15"],
  render: () => chat({ dialog: <DeleteRoomDialog open name="デザインレビュー" defaultConfirmed /> }),
};
