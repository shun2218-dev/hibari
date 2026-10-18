import { describe, expect, it } from "vitest";

import { isUrlFinished, previewCandidates } from "./link-previews";

const ORIGIN = "https://app.hibari-chat.com";

describe("previewCandidates（ADR 0065 決定 3。サーバーの Candidates と同じ規則）", () => {
  it.each<[string, string, string[]]>([
    ["URL がなければ何もない", "おはようございます", []],
    ["同じ URL は 1 つにまとめる", "https://a.example/ https://b.example/ https://a.example/", ["https://a.example/", "https://b.example/"]],
    ["自分のアプリの URL は出さない", `${ORIGIN}/w/a/r/b?m=c と https://a.example/`, ["https://a.example/"]],
    ["LP（apex）は別のオリジンなので出す", "https://hibari-chat.com/", ["https://hibari-chat.com/"]],
    ["コードの中の URL は出さない", "`https://a.example/`", []],
    [
      "5 つまでは出す",
      "https://1.example/ https://2.example/ https://3.example/ https://4.example/ https://5.example/",
      ["https://1.example/", "https://2.example/", "https://3.example/", "https://4.example/", "https://5.example/"],
    ],
    // 数えるのはまとめる前の URL（Slack の「5 つより多いリンク」）
    ["6 つあればどれも出さない", "https://1.example/ https://2.example/ https://3.example/ https://4.example/ https://5.example/ https://1.example/", []],
  ])("%s", (_name, body, want) => {
    expect(previewCandidates(body, ORIGIN)).toEqual(want);
  });
});

describe("isUrlFinished（ADR 0065 決定 13）", () => {
  it.each<[string, string, boolean]>([
    ["後ろに空白があれば書き終えた", "https://a.example/ ", true],
    ["後ろに改行があれば書き終えた", "https://a.example/\n次の行", true],
    ["本文の最後にあればまだ打っているかもしれない", "見て https://a.example/pos", false],
    ["後ろに句読点が続くだけでは、まだ打っているかもしれない", "https://a.example/.", false],
    ["同じ URL が 2 回あれば、どちらかの後ろに空白があればよい", "https://a.example/ と https://a.example/", true],
  ])("%s", (_name, body, want) => {
    const url = body.match(/https:\/\/a\.example\/(pos)?/u)![0];
    expect(isUrlFinished(body, url)).toBe(want);
  });
});
