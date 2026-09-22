import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { chat } from "@/stories/screens";

/**
 * チャット / 入力欄（ADR 0052。リッチテキストの入力欄）。
 *
 * story の id がそのまま docs/ui/screenshots/ の PNG のパスになる（`chat-composer--…` ↔ `chat/composer/….png`。ADR 0047 決定 2）。
 */
const meta = {
  title: "チャット/入力欄",
  // PNG のパス（chat/composer/）と対応させる。title を日本語にしているので、id は自動生成に任せない。
  id: "chat-composer",
  tags: ["screenshot"],
  parameters: { options: { showPanel: false }, screenshot: { source: "app" } },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Formatted: Story = {
  name: "書式とメンションを入れた下書き",
  tags: ["since:6.10"],
  render: () => chat({ composer: "formatted" }),
};

export const FormattedDark: Story = {
  name: "書式とメンションを入れた下書き（ダーク）",
  tags: ["since:6.10"],
  parameters: { theme: "dark" },
  render: () => chat({ composer: "formatted" }),
};

export const ToolbarHidden: Story = {
  name: "書式のツールバーを隠したところ",
  tags: ["since:6.10"],
  render: () => chat({ composer: "toolbar-hidden" }),
};

export const LinkDialog: Story = {
  name: "リンクを入れる画面",
  tags: ["since:6.10"],
  render: () => chat({ composer: "link-dialog" }),
};

export const MobileFormatted: Story = {
  name: "書式とメンションを入れた下書き（モバイル）",
  tags: ["since:6.10"],
  parameters: { screenshot: { size: "390x844" } },
  globals: { viewport: { value: "mobile" } },
  render: () => chat({ composer: "formatted" }),
};
