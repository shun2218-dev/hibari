/**
 * アプリ（`app.`）と LP（apex）の絶対 URL の起点（ADR 0063 決定 5 / 7）。
 *
 * どちらも同じ Next.js のアプリで描き、`proxy.ts` がリクエストのホストを `SITE_BASE_URL` と比べて LP に振り分ける。
 * `metadataBase` に使う値は、静的なページではビルドのときに決まる。なのでどちらの変数も**ビルドの環境**に置く。
 */

/** ローカルの既定。`make web` の Next.js の開発サーバー。 */
export const DEFAULT_APP_BASE_URL = "http://localhost:3000";

/** ローカルの既定。`*.localhost` はループバックに解決されるので、同じ開発サーバーを別のホスト名で開ける。 */
export const DEFAULT_SITE_BASE_URL = "http://lp.localhost:3000";

/**
 * LP の中身を置いたルート。apex の `/` をここに書き換える。
 * `app.` からは開けない（proxy.ts が 404 にする）。同じ中身が 2 つの URL で読めないようにするため。
 */
export const LP_PATH = "/lp";

/** ドキュメントサイト（ADR 0064）。ローカルで起動していることを前提にできないので、LP からは本番を指す。 */
export const DOCS_URL = "https://docs.hibari-chat.com";

export const GITHUB_URL = "https://github.com/shun2218-dev/hibari";

export function appBaseUrl(value: string | undefined = process.env.APP_BASE_URL): URL {
  return new URL(value || DEFAULT_APP_BASE_URL);
}

export function siteBaseUrl(value: string | undefined = process.env.SITE_BASE_URL): URL {
  return new URL(value || DEFAULT_SITE_BASE_URL);
}

/**
 * リクエストの Host が LP のホストか。ポートまで比べる（ローカルは `lp.localhost:3000`）。
 * ホスト名は大文字と小文字を区別しないので、そろえてから比べる。
 */
export function isSiteHost(host: string | null, site: URL = siteBaseUrl()): boolean {
  return host !== null && host.toLowerCase() === site.host;
}
