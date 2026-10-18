import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { colorDeclarations, tokensCSS } from "./tokens.mjs";

const sample = `@import "tailwindcss";
/*
 * ダークは同じ名前の変数を [data-theme="dark"] で上書きする。
 */
@theme static {
  --*: initial;
  --color-primary: #2f6f62;
  --color-overlay: rgb(22 32 29 / 0.4);
  --text-sm: 13px;
  @keyframes spin {
    to { --color-inside: red; }
  }
}
@utility pane-sidebar { width: 1px; }
[data-theme="dark"] {
  --color-primary: #5aa694;
  color-scheme: dark;
}
`;

describe("colorDeclarations", () => {
  it("ブロックの直下の --color-* だけを、書いてある順に返す", () => {
    expect(colorDeclarations(sample, "@theme static")).toEqual([
      ["--color-primary", "#2f6f62"],
      ["--color-overlay", "rgb(22 32 29 / 0.4)"],
    ]);
    expect(colorDeclarations(sample, '[data-theme="dark"]')).toEqual([["--color-primary", "#5aa694"]]);
  });

  it("ブロックがなければ落とす（globals.css の形が変わったら気づく）", () => {
    expect(() => colorDeclarations("", "@theme static")).toThrow();
  });
});

describe("tokensCSS", () => {
  it("ライトを :root、ダークを [data-theme=dark] に置く", () => {
    expect(tokensCSS(sample)).toContain(':root {\n  --color-primary: #2f6f62;\n  --color-overlay: rgb(22 32 29 / 0.4);\n}');
    expect(tokensCSS(sample)).toContain('[data-theme="dark"] {\n  --color-primary: #5aa694;\n}');
  });

  it("本物の globals.css から、サイトが使う色がライトとダークで別の値で取れる", () => {
    const css = tokensCSS(readFileSync(new URL("../../web/app/globals.css", import.meta.url), "utf8"));
    const [light, dark] = css.split('[data-theme="dark"]');
    for (const name of ["--color-background", "--color-surface", "--color-text", "--color-text-muted", "--color-border", "--color-primary", "--color-on-primary", "--color-primary-subtle"]) {
      expect(light).toContain(`${name}:`);
      expect(dark).toContain(`${name}:`);
    }
    // ダークの値がライトと同じなら、ダークのブロックを読みそこなっている
    for (const name of ["--color-background", "--color-text", "--color-primary"]) {
      const value = (block: string) => new RegExp(`${name}: ([^;]+);`).exec(block)?.[1];
      expect(value(dark)).not.toBe(value(light));
    }
  });
});
