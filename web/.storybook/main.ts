import type { StorybookConfig } from "@storybook/nextjs-vite";

/**
 * Storybook は docs/ui/screenshots/ の PNG と 1 対 1 の「画面」を描くためのもの（ADR 0047）。
 * story の id がそのまま PNG のパスになる（`chat--image-viewer` ↔ `chat/image-viewer.png`）。
 */
const config: StorybookConfig = {
  framework: "@storybook/nextjs-vite",
  // 画面の story は stories/ に置く。部品ごとの story が要るようになったら components/ の隣にも置ける。
  stories: ["../stories/**/*.stories.tsx", "../components/**/*.stories.tsx"],
  // モックのアバター（public/dev/）を story から参照する。
  staticDirs: ["../public"],
  // 匿名の利用統計を送らない。
  core: { disableTelemetry: true },
};

export default config;
