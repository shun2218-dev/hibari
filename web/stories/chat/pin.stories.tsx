import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { chat } from "@/stories/screens/chat";

/**
 * チャット / ピン留め（ADR 0054）。
 *
 * story の id がそのまま docs/ui/screenshots/ の PNG のパスになる（`chat-pin--…` ↔ `chat/pin/….png`。ADR 0047 決定 2）。
 */
const meta = {
  title: "チャット/ピン留め",
  id: "chat-pin",
  tags: ["screenshot"],
  parameters: { options: { showPanel: false }, screenshot: { source: "app" } },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Timeline: Story = {
  name: "ピン留めしたメッセージ",
  tags: ["since:6.12"],
  render: () => chat({ pins: "timeline" }),
};

export const TimelineDark: Story = {
  name: "ピン留めしたメッセージ（ダーク）",
  tags: ["since:6.12"],
  parameters: { theme: "dark" },
  render: () => chat({ pins: "timeline", dark: true }),
};

export const Menu: Story = {
  name: "「…」の「チャンネルへピン留めする」",
  tags: ["since:6.12"],
  render: () => chat({ pins: "menu" }),
};

export const MenuPinned: Story = {
  name: "「…」の「チャンネルからピンを外す」",
  tags: ["since:6.12"],
  render: () => chat({ pins: "menu-pinned" }),
};

export const List: Story = {
  name: "「ピン」のタブ",
  tags: ["since:6.12"],
  render: () => chat({ pins: "list" }),
};

export const ListHover: Story = {
  name: "「ピン」のタブ（カードのホバー）",
  tags: ["since:6.12"],
  render: () => chat({ pins: "list-hover" }),
};

export const ListDark: Story = {
  name: "「ピン」のタブ（ダーク）",
  tags: ["since:6.12"],
  parameters: { theme: "dark" },
  render: () => chat({ pins: "list", dark: true }),
};

export const ListEmpty: Story = {
  name: "「ピン」のタブ（まだない）",
  tags: ["since:6.12"],
  render: () => chat({ pins: "list-empty" }),
};

export const MobileTimeline: Story = {
  name: "ピン留めしたメッセージ（モバイル）",
  tags: ["since:6.12"],
  parameters: { screenshot: { size: "390x844" } },
  globals: { viewport: { value: "mobile" } },
  render: () => chat({ pins: "timeline" }),
};

export const MobileList: Story = {
  name: "「ピン」のタブ（モバイル）",
  tags: ["since:6.12"],
  parameters: { screenshot: { size: "390x844" } },
  globals: { viewport: { value: "mobile" } },
  render: () => chat({ pins: "list" }),
};
