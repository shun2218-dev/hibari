import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // LP をローカルで lp.localhost で開く（ADR 0063 決定 7）。開発サーバーは既定で localhost 以外からの
  // 開発用のリクエスト（HMR など）を止めるので、LP のホストも許す
  allowedDevOrigins: ["lp.localhost"],
};

export default nextConfig;
