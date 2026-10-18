import type { MetadataRoute } from "next";

/**
 * アプリ（`app.`）の robots.txt（ADR 0063 決定 5）。
 *
 * 読むのは止めない。止めると、ページに付けた noindex（proxy.ts の `X-Robots-Tag`）を検索エンジンが見られず、
 * よそに貼られた URL だけが検索結果に残りうる。載せないことは noindex で伝える。
 */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/" } };
}
