import type { Metadata } from "next";

import { LandingPage } from "@/components/lp/landing-page";
import { LP_TITLE } from "@/lib/document-title";
import { appBaseUrl, siteBaseUrl } from "@/lib/site";

/**
 * LP（ADR 0063 決定 5）。apex（`hibari-chat.com`）の `/` を proxy.ts がここに書き換える。
 * 絶対 URL の起点を LP のホストにして、canonical が `app.` ではなく apex を指すようにする。
 *
 * `openGraph` はここに書かない。書くと root の `openGraph` を丸ごと置き換え、app/opengraph-image.png（ファイルで置いた画像）も
 * 引き継がれなくなる（og:image が消えることを確かめた）。og:url は canonical があれば要らない。
 * og:image の URL は root の起点（`app.`）で組み立てられるが、どちらのホストでも同じ 1 枚なので（決定 4）そのままにする。
 */
export const metadata: Metadata = {
  title: { absolute: LP_TITLE },
  metadataBase: siteBaseUrl(),
  alternates: { canonical: "/" },
};

export default function LandingRoute() {
  return <LandingPage appBaseUrl={appBaseUrl()} />;
}
