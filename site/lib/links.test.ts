import { describe, expect, it } from "vitest";

import { REPOSITORY_URL, resolveDocLink } from "./links";

describe("resolveDocLink", () => {
  it.each([
    { name: "同じディレクトリの .md に ./ を補う", href: "0011-invite-links.md", file: "adr/README.md", want: "./0011-invite-links.md" },
    { name: "アンカー付きの .md", href: "tokens.md#色", file: "ui/README.md", want: "./tokens.md#色" },
    { name: "./ や ../ で始まる .md はそのまま", href: "../events.md", file: "adr/0015-hub.md", want: "../events.md" },
    {
      name: "docs/ の外のファイルは GitHub に向ける",
      href: "../../web/app/globals.css",
      file: "ui/tokens.md",
      want: `${REPOSITORY_URL}/blob/main/web/app/globals.css`,
    },
    {
      name: "docs/ の外の .md も GitHub に向ける",
      href: "../CLAUDE.md#目的",
      file: "roadmap.md",
      want: `${REPOSITORY_URL}/blob/main/CLAUDE.md#目的`,
    },
    {
      name: "docs/ の中の .md 以外（画像など）は GitHub に向ける",
      href: "screenshots/chat/timeline/default.png",
      file: "ui/README.md",
      want: `${REPOSITORY_URL}/blob/main/docs/ui/screenshots/chat/timeline/default.png`,
    },
    { name: "URL はそのまま", href: "https://resend.com/docs", file: "deploy.md", want: "https://resend.com/docs" },
    { name: "ページ内のアンカーはそのまま", href: "#背景", file: "adr/0001.md", want: "#背景" },
    { name: "サイトの絶対パスはそのまま", href: "/rest-api", file: "events.md", want: "/rest-api" },
  ])("$name", ({ href, file, want }) => {
    expect(resolveDocLink(href, file)).toBe(want);
  });
});
