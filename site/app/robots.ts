import type { MetadataRoute } from "next";

export const dynamic = "force-static";

/** 検索エンジンに載せない（ADR 0064 決定 6）。秘密はないので、読ませないだけでよい（Storybook と同じ）。 */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
