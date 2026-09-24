import { NextResponse } from "next/server";

/**
 * アプリ（`app.`）のページを検索エンジンに載せない（ADR 0063 決定 5）。
 *
 * robots.txt の Disallow ではなく `X-Robots-Tag: noindex` にするのは、Disallow が「読みに来るな」であって「載せるな」ではないため。
 * Disallow にすると、よそに貼られた招待リンク（`/j/<code>`）の URL だけが中身なしで検索結果に出うる（コードが並ぶ）。
 * 読ませたうえで noindex を返せば、検索エンジンは URL ごと落とす。
 * ページごとの `metadata` ではなくここで付けるのは、ページを足すたびに書くことを覚えている運用に頼らないため。
 *
 * LP（`hibari-chat.com`）を同じアプリで描くようになったら、ここでホストを見て LP に振り分け、LP には付けない。
 */
export const ROBOTS_TAG = "noindex, nofollow";

export function proxy(): NextResponse {
  const response = NextResponse.next();
  response.headers.set("X-Robots-Tag", ROBOTS_TAG);
  return response;
}

export const config = {
  // ビルドした JS / CSS と画像の最適化は HTML ではないので通さない（毎回 proxy を動かさない）
  matcher: ["/((?!_next/static|_next/image).*)"],
};
