import { siteBaseUrl } from "@/lib/site";

/**
 * LP（apex）の robots.txt（ADR 0063 決定 5）。proxy.ts が apex の `/robots.txt` をここに書き換える。
 *
 * app/robots.ts はアプリ（`app.`）のもので、ルートにしか置けない。apex の分をここに分けるのは、
 * 同じ robots.ts の中でホストを見て分けると、ホストで分ける判断が proxy.ts とここの 2 か所に散るため。
 */
export function GET(): Response {
  const sitemap = new URL("/sitemap.xml", siteBaseUrl()).href;
  return new Response(`User-Agent: *\nAllow: /\n\nSitemap: ${sitemap}\n`, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
