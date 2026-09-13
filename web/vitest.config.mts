import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  // tsconfig.json の paths（@/*）をテストでも解決する。
  resolve: { tsconfigPaths: true },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    // テストごとにモックを元に戻し、テスト同士が状態を共有しないようにする。
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
  },
});
