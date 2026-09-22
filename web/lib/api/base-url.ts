/**
 * Go の API サーバーのベース URL を返す。
 *
 * NEXT_PUBLIC_ を付けるのは、Phase 6 でブラウザからも API を直接呼ぶため
 * （Next.js の Route Handler にはビジネスロジックを置かない。CLAUDE.md）。
 * この値はビルド時に JS に埋め込まれるので、環境ごとにビルドし直す必要がある。
 *
 * 未設定や不正な値は、リクエストのたびに分かりにくく壊れるより、読んだ時点で明確に失敗させる。
 */
export function getApiBaseUrl(
  value: string | undefined = process.env.NEXT_PUBLIC_API_BASE_URL,
): string {
  if (!value) {
    throw new Error(
      "NEXT_PUBLIC_API_BASE_URL is not set (web/.env.example を web/.env.local にコピーする)",
    );
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`NEXT_PUBLIC_API_BASE_URL is not a valid URL: ${value}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`NEXT_PUBLIC_API_BASE_URL must be http(s): ${value}`);
  }
  if (url.search || url.hash) {
    throw new Error(`NEXT_PUBLIC_API_BASE_URL must not have a query or fragment: ${value}`);
  }

  // 末尾のスラッシュを落とし、呼び出し側は常に `${base}/api/v1/...` と書けるようにする。
  return url.toString().replace(/\/+$/, "");
}
