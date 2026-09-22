import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { chat } from "@/stories/screens";

/**
 * チャット / 本文の書式（ADR 0051）。
 *
 * story の id がそのまま docs/ui/screenshots/ の PNG のパスになる（`chat-format--…` ↔ `chat/format/….png`。ADR 0047 決定 2）。
 */
const meta = {
  title: "チャット/本文の書式",
  // PNG のパス（chat/format/）と対応させる。title を日本語にしているので、id は自動生成に任せない。
  id: "chat-format",
  tags: ["screenshot"],
  parameters: { options: { showPanel: false }, screenshot: { source: "app" } },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Formatting: Story = {
  name: "書式（太字・リスト・リンク・引用・コード）",
  tags: ["since:6.10"],
  render: () => chat({ formatting: true }),
};

export const FormattingDark: Story = {
  name: "書式（ダーク）",
  tags: ["since:6.10"],
  parameters: { theme: "dark" },
  render: () => chat({ formatting: true }),
};

export const MobileFormatting: Story = {
  name: "書式（モバイル）",
  tags: ["since:6.10"],
  parameters: { screenshot: { size: "390x844" } },
  globals: { viewport: { value: "mobile" } },
  render: () => chat({ formatting: true }),
};
