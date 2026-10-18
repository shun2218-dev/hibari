import { type NextRequest, NextResponse } from "next/server";

import { isSiteHost, LP_PATH } from "@/lib/site";

/**
 * ホストで LP とアプリを分ける（ADR 0063 決定 5）。
 *
 * - LP（`hibari-chat.com`）: 検索エンジンに載せる。パスを `/lp` の下に書き換える（`/` → `/lp`、`/robots.txt` → `/lp/robots.txt`）。
 *   LP にない URL は `/lp` の下で見つからず 404 になる。apex でアプリの画面が開けてしまわないようにするため。
 * - アプリ（`app.`）: すべてのページを検索エンジンに載せない。
 *
 * robots.txt の Disallow ではなく `X-Robots-Tag: noindex` にするのは、Disallow が「読みに来るな」であって「載せるな」ではないため。
 * Disallow にすると、よそに貼られた招待リンク（`/j/<code>`）の URL だけが中身なしで検索結果に出うる（コードが並ぶ）。
 * 読ませたうえで noindex を返せば、検索エンジンは URL ごと落とす。
 * ページごとの `metadata` ではなくここで付けるのは、ページを足すたびに書くことを覚えている運用に頼らないため。
 */
export const ROBOTS_TAG = "noindex, nofollow";

/**
 * LP のホストでも書き換えずにそのまま返すファイル。app/ の直下に置いたファビコンと OGP 画像で、LP のページもこれを指す。
 * `/_next/static` と `/_next/image` は、そもそも proxy を通らない（下の matcher）。
 */
export const SITE_FILES: ReadonlySet<string> = new Set([
  "/favicon.ico",
  "/icon.svg",
  "/apple-icon.png",
  "/opengraph-image.png",
]);

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  if (isSiteHost(request.headers.get("host"))) {
    if (SITE_FILES.has(pathname)) return NextResponse.next();
    const url = request.nextUrl.clone();
    url.pathname = pathname === "/" ? LP_PATH : `${LP_PATH}${pathname}`;
    return NextResponse.rewrite(url);
  }

  // LP の中身を `app.` から読ませない（同じページが 2 つの URL で読めると、どちらが正か検索エンジンが迷う）
  if (pathname === LP_PATH || pathname.startsWith(`${LP_PATH}/`)) {
    return new NextResponse(null, { status: 404, headers: { "X-Robots-Tag": ROBOTS_TAG } });
  }
  const response = NextResponse.next();
  response.headers.set("X-Robots-Tag", ROBOTS_TAG);
  return response;
}

export const config = {
  // ビルドした JS / CSS と画像の最適化は HTML ではないので通さない（毎回 proxy を動かさない）
  matcher: ["/((?!_next/static|_next/image).*)"],
};
