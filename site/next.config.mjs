import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  // 静的に書き出し、Storybook と同じく Fly の静的なアプリで配る（ADR 0064 決定 6）
  output: "export",
  reactStrictMode: true,
  // docs/ はこのプロジェクトの外（リポジトリのルート）にある。Turbopack は root の外を読まないので、リポジトリのルートまで広げる
  turbopack: { root: dirname(dirname(fileURLToPath(import.meta.url))) },
};

export default withMDX(config);
