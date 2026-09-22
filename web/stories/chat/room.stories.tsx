import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { AddRoomMemberDialog } from "@/components/chat/dialogs/add-room-member";
import { CreateRoomDialog } from "@/components/chat/dialogs/create-room";
import { LeaveRoomDialog } from "@/components/chat/dialogs/leave-room";
import { StartDmDialog } from "@/components/chat/dialogs/start-dm";

import { dmCandidates, users } from "@/stories/fixtures";
import { chat, noop, roomHeaderFrame, roomSettingsDialog, sidebarFrame } from "@/stories/screens";

/**
 * チャット / チャンネルとメンバー。
 *
 * story の id がそのまま docs/ui/screenshots/ の PNG のパスになる（`chat-room--…` ↔ `chat/room/….png`。ADR 0047 決定 2）。
 * title は日本語にできるが、id は PNG のパスに合わせて固定する。
 */
const meta = {
  title: "チャット/チャンネルとメンバー",
  // PNG のパス（chat/room/）と対応させる。title を日本語にしているので、id は自動生成に任せない。
  id: "chat-room",
  // この tag が「docs/ui/screenshots/ の PNG と 1 対 1 の画面」の印。撮影ツールと 1 対 1 の検査がこれで選ぶ。
  tags: ["screenshot"],
  // 画面を見るための story で、引数をいじる想定がないので下のパネルは出さない。
  // screenshot はこの tag と対で「撮影の対象」を表す。既定は実装から撮ったもの（story ごとに上書きする）。
  parameters: { options: { showPanel: false }, screenshot: { source: "app" } },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const EmptyRooms: Story = {
  name: "チャンネルが 0 件",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () => chat({ noRooms: true }),
};

export const PublicPreview: Story = {
  name: "public ルームを参加せずに閲覧",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () => chat({ footer: "join" }),
};

export const RemovedFromChannel: Story = {
  name: "チャンネルにアクセスできない（外された）",
  tags: ["since:1.5"],
  render: () => chat({ body: "removed-room", footer: "none" }),
};

export const MembersPanel: Story = {
  name: "メンバーパネル",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () => chat({ members: true }),
};

export const ChannelCreateDialog: Story = {
  name: "チャンネルを作成",
  tags: ["since:6-1"],
  parameters: { screenshot: { source: "design", size: "520x540" } },
  render: () => chat({ dialog: <CreateRoomDialog open name="デザインレビュー" kind="public" /> }),
};

export const DmDialog: Story = {
  name: "ダイレクトメッセージを開く",
  tags: ["since:6-1"],
  parameters: { screenshot: { source: "design", size: "520x600" } },
  render: () =>
    chat({
      dialog: (
        <StartDmDialog
          open
          candidates={dmCandidates}
          selectedId={users.naoki.id}
        />
      ),
    }),
};

export const RoomSettingsDialog: Story = {
  name: "チャンネルの設定",
  tags: ["since:6-1"],
  parameters: { screenshot: { source: "design", size: "560x640" } },
  render: () => chat({ dialog: roomSettingsDialog({ canEdit: true }) }),
};

export const SearchEmpty: Story = {
  name: "チャンネル検索の 0 件",
  tags: ["since:6-1"],
  parameters: { screenshot: { source: "design", size: "380x520" } },
  render: () => chat({ noRooms: true, search: "見積" }),
};

export const SidebarAddEntries: Story = {
  name: "サイドバーの作成・DM の入口",
  tags: ["since:6-2"],
  parameters: { screenshot: { size: "320x560" } },
  render: sidebarFrame,
};

export const RoomHeaderSettings: Story = {
  name: "ルームのヘッダーの設定",
  tags: ["since:6-2"],
  parameters: { screenshot: { size: "900x120" } },
  render: roomHeaderFrame,
};

export const MemberAddDialog: Story = {
  name: "チャンネルにメンバーを追加",
  tags: ["since:6-2"],
  render: () =>
    chat({ dialog: <AddRoomMemberDialog open candidates={dmCandidates} selectedId={users.ryo.id} /> }),
};

// 退出はロールに関係なくできるので、読み取り専用（member）の設定で見せる
// 退出はロールに関係なくできるので、読み取り専用（member）の設定で見せる
export const RoomSettingsLeave: Story = {
  name: "チャンネルの設定からの退出",
  tags: ["since:6"],
  render: () => chat({ dialog: roomSettingsDialog({ canEdit: false, onLeave: noop }) }),
};

export const DialogLeaveRoom: Story = {
  name: "チャンネルの退出の確認（公開）",
  tags: ["since:6"],
  render: () => chat({ dialog: <LeaveRoomDialog open kind="public" name="デザインレビュー" /> }),
};

export const DialogLeaveRoomPrivate: Story = {
  name: "チャンネルの退出の確認（非公開）",
  tags: ["since:6"],
  render: () => chat({ dialog: <LeaveRoomDialog open kind="private" name="リリース準備" /> }),
};

export const MobileRooms: Story = {
  name: "チャンネル一覧（モバイル）",
  tags: ["since:1.5"],
  parameters: { screenshot: { size: "390x844", source: "design" } },
  globals: { viewport: { value: "mobile" } },
  render: () => chat({ mobileView: "list" }),
};

export const MobileMembersSheet: Story = {
  name: "メンバーシート（モバイル）",
  tags: ["since:1.5"],
  parameters: { screenshot: { size: "390x844", source: "design" } },
  globals: { viewport: { value: "mobile" } },
  render: () => chat({ members: true }),
};
