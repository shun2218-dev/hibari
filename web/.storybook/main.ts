import type { StorybookConfig } from "@storybook/nextjs-vite";

/**
 * Storybook は docs/ui/screenshots/ の PNG と 1 対 1 の「画面」を描くためのもの（ADR 0047）。
 * story の id がそのまま PNG のパスになる（`chat-attachment--image-viewer` ↔ `chat/attachment/image-viewer.png`）。
 */
const config: StorybookConfig = {
  framework: "@storybook/nextjs-vite",
  // 画面の story は stories/ に置く。部品ごとの story が要るようになったら components/ の隣にも置ける。
  stories: ["../stories/**/*.stories.tsx", "../components/**/*.stories.tsx"],
  // モックのアバター（public/dev/）を story から参照する。static/ は Storybook だけに出すもの（robots.txt。ADR 0063 決定 5）で、
  // public/ に置くとアプリの robots.txt（app/robots.ts）とぶつかる。
  staticDirs: ["../public", { from: "./static", to: "/" }],
  // 匿名の利用統計と、Storybook 自身のお知らせを出さない（画面の確認に集中できるように）。
  core: { disableTelemetry: true, disableWhatsNewNotifications: true },
};

export default config;
