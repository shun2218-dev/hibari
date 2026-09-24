// @vitest-environment node
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { config, proxy, ROBOTS_TAG } from "./proxy";

// 既定の SITE_BASE_URL（lib/site.ts）。テストの環境には置いていない
const SITE = "http://lp.localhost:3000";
const APP = "http://localhost:3000";

function request(base: string, path: string): NextRequest {
  return new NextRequest(new URL(path, base), { headers: { host: new URL(base).host } });
}

/** 書き換え先のパス。書き換えていなければ null。 */
function rewrittenPath(response: Response): string | null {
  const to = response.headers.get("x-middleware-rewrite");
  return to === null ? null : new URL(to).pathname;
}

describe("proxy", () => {
  describe("アプリのホスト", () => {
    it("X-Robots-Tag: noindex を付ける", () => {
      const response = proxy(request(APP, "/login"));
      expect(response.headers.get("X-Robots-Tag")).toBe(ROBOTS_TAG);
      expect(ROBOTS_TAG).toContain("noindex");
      expect(rewrittenPath(response)).toBeNull();
    });

    it.each(["/lp", "/lp/robots.txt", "/lp/sitemap.xml"])("LP の中身（%s）は 404 にする", (path) => {
      const response = proxy(request(APP, path));
      expect(response.status).toBe(404);
      expect(response.headers.get("X-Robots-Tag")).toBe(ROBOTS_TAG);
    });

    it("/lp で始まるだけの別のパスは止めない", () => {
      expect(proxy(request(APP, "/lpx")).status).toBe(200);
    });
  });

  describe("LP のホスト", () => {
    it.each([
      ["/", "/lp"],
      ["/robots.txt", "/lp/robots.txt"],
      ["/sitemap.xml", "/lp/sitemap.xml"],
      // LP にない URL は /lp の下で見つからず 404 になる（apex でアプリの画面を開かせない）
      ["/login", "/lp/login"],
      ["/j/abcdefghijklmnopqrstuv", "/lp/j/abcdefghijklmnopqrstuv"],
    ])("%s を %s に書き換える", (path, want) => {
      expect(rewrittenPath(proxy(request(SITE, path)))).toBe(want);
    });

    it.each(["/favicon.ico", "/icon.svg", "/apple-icon.png", "/opengraph-image.png"])("%s はそのまま返す", (path) => {
      expect(rewrittenPath(proxy(request(SITE, path)))).toBeNull();
    });

    it("noindex を付けない", () => {
      expect(proxy(request(SITE, "/")).headers.get("X-Robots-Tag")).toBeNull();
    });

    it("ホスト名の大文字と小文字は区別しない", () => {
      const req = new NextRequest(new URL("/", SITE), { headers: { host: "LP.localhost:3000" } });
      expect(rewrittenPath(proxy(req))).toBe("/lp");
    });

    it("ポートが違えば LP ではない", () => {
      const req = new NextRequest(new URL("/", "http://lp.localhost:3001"), { headers: { host: "lp.localhost:3001" } });
      expect(rewrittenPath(proxy(req))).toBeNull();
    });
  });

  it.each([
    ["/login", true],
    ["/j/abcdefghijklmnopqrstuv", true],
    ["/w/ws-1/r/r-1", true],
    ["/robots.txt", true],
    ["/_next/static/chunks/main.js", false],
    ["/_next/image", false],
  ])("%s を通すか: %s", (path, want) => {
    const [pattern] = config.matcher;
    expect(new RegExp(`^${pattern}$`).test(path)).toBe(want);
  });
});
