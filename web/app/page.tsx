import { connection } from "next/server";

import { getApiBaseUrl } from "@/lib/api-base-url";
import { fetchApiHealth } from "@/lib/api-health";

// Phase 1 の骨組み。ホストの Next.js からコンテナの API に届くことだけを確かめる。
// 画面は Phase 1.5 でデザインを取り込み、Phase 6 で実装する。
export default async function Home() {
  // ビルド時ではなくリクエストのたびに API の状態を見る。
  await connection();
  const health = await fetchApiHealth(getApiBaseUrl());

  return (
    <main>
      <h1>hibari</h1>
      <p>API: {health}</p>
    </main>
  );
}
