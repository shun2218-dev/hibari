import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // LP をローカルで lp.localhost で開く（ADR 0063 決定 7）。開発サーバーは既定で localhost 以外からの
  // 開発用のリクエスト（HMR など）を止めるので、LP のホストも許す
  allowedDevOrigins: ["lp.localhost"],
  async headers() {
    return [
      {
        // Service Worker（ADR 0069）は HTTP のキャッシュから読ませない。古い版が残ると、通知の出し方を直しても届かない
        // （登録の updateViaCache: none と二重に止める。Next.js の PWA の手引きと同じ）
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }],
      },
    ];
  },
};

export default nextConfig;
