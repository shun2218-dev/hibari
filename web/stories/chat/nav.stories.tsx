import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { chat } from "@/stories/screens/chat";

/**
 * チャット / サイドバーの左のメニュー（ADR 0058）。ホームと DM。アクティビティは activity.stories.tsx、「後で」は saved.stories.tsx。
 *
 * story の id がそのまま docs/ui/screenshots/ の PNG のパスになる（`chat-nav--…` ↔ `chat/nav/….png`。ADR 0047 決定 2）。
 */
const meta = {
  title: "チャット/左のメニュー",
  id: "chat-nav",
  tags: ["screenshot"],
  parameters: { options: { showPanel: false }, screenshot: { source: "app" } },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Home: Story = {
  name: "ホーム（左のメニュー）",
  tags: ["since:6.14.5"],
  render: () => chat({ side: "home" }),
};

export const HomeDark: Story = {
  name: "ホーム（左のメニュー・ダーク）",
  tags: ["since:6.14.5"],
  parameters: { theme: "dark" },
  render: () => chat({ side: "home", dark: true }),
};

export const Dms: Story = {
  name: "DM の一覧",
  tags: ["since:6.14.5"],
  render: () => chat({ side: "dms" }),
};

export const DmsEmpty: Story = {
  name: "DM の一覧（空）",
  tags: ["since:6.14.5"],
  render: () => chat({ side: "dms", dmsEmpty: true }),
};



export const RailSwitcher: Story = {
  name: "左のメニューからワークスペースを切り替える",
  tags: ["since:6.14.5"],
  render: () => chat({ side: "home", switcher: true }),
};

export const RailAccount: Story = {
  name: "左のメニューのアカウントのメニュー",
  tags: ["since:6.14.5"],
  render: () => chat({ side: "home", accountMenu: true }),
};

export const MobileHome: Story = {
  name: "ホーム（モバイル）",
  tags: ["since:6.14.5"],
  parameters: { screenshot: { size: "390x844" } },
  globals: { viewport: { value: "mobile" } },
  render: () => chat({ side: "home", mobileView: "list" }),
};

export const MobileDms: Story = {
  name: "DM の一覧（モバイル）",
  tags: ["since:6.14.5"],
  parameters: { screenshot: { size: "390x844" } },
  globals: { viewport: { value: "mobile" } },
  render: () => chat({ side: "dms", mobileView: "list" }),
};

export const DmsUnread: Story = {
  name: "DM の一覧（未読メッセージだけ）",
  tags: ["since:6.14.5"],
  render: () => chat({ side: "dms", dmsUnread: true }),
};

export const PreviewDms: Story = {
  name: "左のメニューにポインタを乗せて DM を重ねて出す",
  tags: ["since:6.14.5"],
  render: () => chat({ side: "home", preview: "dms" }),
};

export const PreviewActivity: Story = {
  name: "左のメニューにポインタを乗せてアクティビティを重ねて出す",
  tags: ["since:6.14.5"],
  render: () => chat({ side: "home", preview: "activity" }),
};

export const PreviewActivityDark: Story = {
  name: "左のメニューにポインタを乗せてアクティビティを重ねて出す（ダーク）",
  tags: ["since:6.14.5"],
  parameters: { theme: "dark" },
  render: () => chat({ side: "home", preview: "activity", dark: true }),
};

export const PreviewLater: Story = {
  name: "左のメニューにポインタを乗せて「後で」を重ねて出す",
  tags: ["since:6.14.5"],
  render: () => chat({ side: "home", preview: "later" }),
};
