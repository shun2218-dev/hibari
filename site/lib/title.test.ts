import { describe, expect, it } from "vitest";

import { firstHeading } from "./title";

describe("firstHeading", () => {
  it.each([
    { name: "最初の # 見出し", source: "前置き\n\n# WebSocket イベント\n\n## 節\n", want: "WebSocket イベント" },
    { name: "バッククォートを外す", source: "# 0062. 本文の `#チャンネル名` をリンクにする\n", want: "0062. 本文の #チャンネル名 をリンクにする" },
    { name: "閉じの # を外す", source: "# 題名 ##\n", want: "題名" },
    { name: "## は見出しにしない", source: "## 節だけ\n", want: "roadmap" },
  ])("$name", ({ source, want }) => {
    expect(firstHeading(source, "docs/roadmap.md")).toBe(want);
  });
});
