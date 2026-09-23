import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { chat } from "@/stories/screens/chat";

/**
 * チャット / メッセージの検索（ADR 0061）。
 *
 * 検索語は「面談」。**2 文字の日本語**は pg_bigm を選んだ理由そのもの（ADR 0061 の「検証の結果」）なので、画面でもその場合を見せる。
 *
 * story の id がそのまま docs/ui/screenshots/ の PNG のパスになる（`chat-search--…` ↔ `chat/search/….png`。ADR 0047 決定 2）。
 */
const meta = {
  title: "チャット/検索",
  id: "chat-search",
  tags: ["screenshot"],
  parameters: { options: { showPanel: false }, screenshot: { source: "app" } },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Bar: Story = {
  name: "上部の帯（検索していないとき）",
  tags: ["since:6.16"],
  render: () => chat({}),
};

export const Panel: Story = {
  name: "検索欄を押したところ",
  tags: ["since:6.16"],
  render: () => chat({ messageSearch: "panel" }),
};

export const PanelTyped: Story = {
  name: "検索欄に語を打ったところ",
  tags: ["since:6.16"],
  render: () => chat({ messageSearch: "panel-typed" }),
};

export const Results: Story = {
  name: "検索結果",
  tags: ["since:6.16"],
  render: () => chat({ messageSearch: "results" }),
};

export const ResultsDark: Story = {
  name: "検索結果（ダーク）",
  tags: ["since:6.16"],
  parameters: { theme: "dark" },
  render: () => chat({ messageSearch: "results", dark: true }),
};

export const ResultsFiltered: Story = {
  name: "検索結果（送信者と場所で絞り込み中）",
  tags: ["since:6.16"],
  render: () => chat({ messageSearch: "results-filtered" }),
};

export const ResultsEmpty: Story = {
  name: "検索結果（0 件）",
  tags: ["since:6.16"],
  render: () => chat({ messageSearch: "results-empty" }),
};

export const Filters: Story = {
  name: "検索フィルター",
  tags: ["since:6.16"],
  render: () => chat({ messageSearch: "filters" }),
};

export const MobilePanel: Story = {
  name: "検索欄を押したところ（モバイル）",
  tags: ["since:6.16"],
  parameters: { screenshot: { size: "390x844" } },
  globals: { viewport: { value: "mobile" } },
  render: () => chat({ messageSearch: "panel" }),
};

export const MobileResults: Story = {
  name: "検索結果（モバイル）",
  tags: ["since:6.16"],
  parameters: { screenshot: { size: "390x844" } },
  globals: { viewport: { value: "mobile" } },
  render: () => chat({ messageSearch: "results" }),
};
