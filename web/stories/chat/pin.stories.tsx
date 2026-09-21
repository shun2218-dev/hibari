import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { chat } from "../screens";

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
  name: "ピン留めしたメッセージとチャンネルのログ",
  tags: ["since:6.12"],
  render: () => chat({ pins: "timeline" }),
};

export const TimelineDark: Story = {
  name: "ピン留めしたメッセージ（ダーク）",
  tags: ["since:6.12"],
  parameters: { theme: "dark" },
  render: () => chat({ pins: "timeline" }),
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

export const Panel: Story = {
  name: "ピン留めの一覧",
  tags: ["since:6.12"],
  render: () => chat({ pins: "panel" }),
};

export const PanelDark: Story = {
  name: "ピン留めの一覧（ダーク）",
  tags: ["since:6.12"],
  parameters: { theme: "dark" },
  render: () => chat({ pins: "panel" }),
};

export const PanelEmpty: Story = {
  name: "ピン留めの一覧（まだない）",
  tags: ["since:6.12"],
  render: () => chat({ pins: "panel-empty" }),
};

export const MobileTimeline: Story = {
  name: "ピン留めしたメッセージ（モバイル）",
  tags: ["since:6.12"],
  parameters: { screenshot: { size: "390x844" } },
  globals: { viewport: { value: "mobile" } },
  render: () => chat({ pins: "timeline" }),
};

export const MobilePanel: Story = {
  name: "ピン留めの一覧（モバイル）",
  tags: ["since:6.12"],
  parameters: { screenshot: { size: "390x844" } },
  globals: { viewport: { value: "mobile" } },
  render: () => chat({ pins: "panel" }),
};
