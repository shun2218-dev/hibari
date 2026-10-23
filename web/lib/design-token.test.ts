import { describe, expect, it } from "vitest";

import { lightColorToken } from "./design-token";

const css = `
@theme static {
  --*: initial;
  --color-background: #f2f5f2;
  --color-surface-muted: #e8ede9;
  --color-surface: #ffffff;
}

[data-theme="dark"] {
  --color-background: #0f1513;
}
`;

describe("lightColorToken", () => {
  it("@theme（ライト）の値を読み、ダークの上書きは見ない", () => {
    expect(lightColorToken(css, "--color-background")).toBe("#f2f5f2");
  });

  it("名前の前方一致で別のトークンを拾わない", () => {
    expect(lightColorToken(css, "--color-surface")).toBe("#ffffff");
  });

  it("ないトークンは投げる（manifest のビルドで気づけるように）", () => {
    expect(() => lightColorToken(css, "--color-nope")).toThrow("--color-nope");
    expect(() => lightColorToken("", "--color-background")).toThrow();
  });
});
