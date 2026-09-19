import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // docs/ui のスクリーンショットを撮るときは、開発インジケータが写り込まないように消す（tools/shoot-ui.sh）。
  ...(process.env.HIBARI_SCREENSHOTS ? { devIndicators: false as const } : {}),
};

export default nextConfig;
