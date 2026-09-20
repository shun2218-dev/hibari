import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // tsconfig.json の paths（@/*）をテストでも解決する。
    tsconfigPaths: true,
    // next/font はビルド時の変換なので、テストでは差し替える（Storybook と本番では本物が動く）。
    alias: { "next/font/google": new URL("./test/next-font.ts", import.meta.url).pathname },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    // テストごとにモックを元に戻し、テスト同士が状態を共有しないようにする。
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
  },
});
