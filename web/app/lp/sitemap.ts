import type { MetadataRoute } from "next";

import { siteBaseUrl } from "@/lib/site";

/** LP（apex）の sitemap（ADR 0063 決定 5）。載せるのは LP の 1 ページだけ。proxy.ts が `/sitemap.xml` をここに書き換える。 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: siteBaseUrl().href }];
}
