import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { LandingPage } from "@/components/lp/landing-page";

/**
 * LP（`hibari-chat.com`。ADR 0063 決定 5 / 6）。
 *
 * story の id がそのまま docs/ui/screenshots/ の PNG のパスになる（`lp--desktop` ↔ `lp/desktop.png`。ADR 0047 決定 2）。
 * 大きさはページの全体が 1 枚に収まる高さにしてある（デザインのキャンバスもページの全体を 1 枚で描いている）。
 * LP はライトだけなので、ダークの story はない（決定 6）。
 */
const meta = {
  title: "LP",
  // PNG のパス（lp/）と対応させる。title を日本語にしているので、id は自動生成に任せない。
  id: "lp",
  // この tag が「docs/ui/screenshots/ の PNG と 1 対 1 の画面」の印。撮影ツールと 1 対 1 の検査がこれで選ぶ。
  tags: ["screenshot"],
  parameters: { options: { showPanel: false }, screenshot: { source: "app" } },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

const APP_BASE_URL = new URL("https://app.hibari-chat.com");

export const Desktop: Story = {
  name: "LP（デスクトップ）",
  tags: ["since:7"],
  parameters: { screenshot: { size: "1280x2234" } },
  render: () => <LandingPage appBaseUrl={APP_BASE_URL} />,
};

export const Mobile: Story = {
  name: "LP（モバイル）",
  tags: ["since:7"],
  // Storybook 上でも 390px で見る（撮影は data-shot-size を見る）
  globals: { viewport: { value: "mobile" } },
  parameters: { screenshot: { size: "390x2723" } },
  render: () => <LandingPage appBaseUrl={APP_BASE_URL} />,
};
