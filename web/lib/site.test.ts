import { describe, expect, it } from "vitest";

import { appBaseUrl, isSiteHost, siteBaseUrl } from "./site";

describe("site", () => {
  it("未設定ならローカルの既定を使う", () => {
    expect(appBaseUrl(undefined).href).toBe("http://localhost:3000/");
    expect(siteBaseUrl(undefined).href).toBe("http://lp.localhost:3000/");
    expect(siteBaseUrl("").href).toBe("http://lp.localhost:3000/");
  });

  it("設定した値を使う", () => {
    expect(appBaseUrl("https://app.hibari-chat.com").href).toBe("https://app.hibari-chat.com/");
    expect(siteBaseUrl("https://hibari-chat.com").href).toBe("https://hibari-chat.com/");
  });

  it.each([
    ["hibari-chat.com", true],
    ["HIBARI-CHAT.com", true],
    ["app.hibari-chat.com", false],
    ["hibari-chat.com:8443", false],
    [null, false],
  ])("isSiteHost(%s) は %s", (host, want) => {
    expect(isSiteHost(host, new URL("https://hibari-chat.com"))).toBe(want);
  });
});
