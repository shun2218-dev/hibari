// @vitest-environment node
// Tailwind のコンパイラはネイティブモジュールを使うので、jsdom ではなく node で動かす。

import { readFileSync } from "node:fs";
import path from "node:path";

import tailwind from "@tailwindcss/postcss";
import postcss from "postcss";
import { beforeAll, describe, expect, it } from "vitest";

const cssPath = path.join(import.meta.dirname, "globals.css");
const source = readFileSync(cssPath, "utf8");

// 実際に Tailwind でコンパイルした結果を検証する。@source inline で使うクラスを直接指定し、
// リポジトリ内のファイルを走査しない（base をどこにも存在しないディレクトリにする）。
async function compile(classes: string[]): Promise<string> {
  const input = `${source}\n@source inline("${classes.join(" ")}");\n`;
  const result = await postcss([tailwind({ base: path.join(import.meta.dirname, "__no_scan__") })]).process(
    input,
    { from: cssPath },
  );
  return result.css;
}

// `selector { ... }` のブロックから、定義されているカスタムプロパティ名を取り出す。
function customPropertiesIn(css: string, selector: string): Set<string> {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`block not found: ${selector}`);
  const end = css.indexOf("}", start);
  return new Set(css.slice(start, end).match(/--[a-z0-9-]+(?=:)/g) ?? []);
}

describe("globals.css", () => {
  let css: string;

  beforeAll(async () => {
    css = await compile([
      "bg-surface",
      "text-text-muted",
      "text-lg",
      "text-display",
      // LP だけに使うトークン（ADR 0063）
      "leading-tight",
      "shadow-showcase",
      "rounded-md",
      "p-2",
      "md:flex",
      "dark:bg-surface",
      // 既定テーマを捨てているので、これらは生成されてはいけない
      "text-red-500",
      "bg-white",
      "rounded-xl",
      "leading-snug",
      "shadow-lg",
      "sm:flex",
      // 中身に合わせて伸びる入力欄と、伸縮できるエリア（ADR 0048）
      "composer-lines",
      "md:pane-sidebar",
      "md:pane-members",
      "md:pane-thread",
    ]);
  });

  it("defines every light color token again for dark", () => {
    const light = [...customPropertiesIn(css, ":root, :host")].filter((p) => p.startsWith("--color-"));
    const dark = [...customPropertiesIn(css, '[data-theme="dark"]')].filter((p) => p.startsWith("--color-"));

    expect(light.length).toBeGreaterThan(0);
    expect(new Set(dark)).toEqual(new Set(light));
  });

  it("emits all tokens even when no utility uses them", () => {
    // インラインの style から var() で参照するトークン（アバターの色など）が消えないようにする
    const root = customPropertiesIn(css, ":root, :host");

    expect(root).toContain("--color-avatar-6");
    expect(root).toContain("--color-on-attention");
  });

  it.each([
    [".bg-surface", "var(--color-surface)"],
    [".text-text-muted", "var(--color-text-muted)"],
    [".text-lg", "var(--text-lg)"],
    [".text-display", "var(--text-display)"],
    [".leading-tight", "var(--leading-tight)"],
    [".shadow-showcase", "0 24px 48px -24px"],
    [".rounded-md", "var(--radius-md)"],
    [".p-2", "calc(var(--spacing) * 2)"],
  ])("maps %s to a token", (selector, value) => {
    const start = css.indexOf(`${selector} {`);

    expect(start).toBeGreaterThan(-1);
    expect(css.slice(start, css.indexOf("}", start))).toContain(value);
  });

  it("switches dark mode by the data-theme attribute, not the OS setting", () => {
    expect(css).toContain('.dark\\:bg-surface:where([data-theme="dark"], [data-theme="dark"] *)');
    expect(css).not.toContain("prefers-color-scheme");
  });

  it.each([".text-red-500", ".bg-white", ".rounded-xl", ".leading-snug", ".shadow-lg", ".sm\\:flex"])(
    "does not generate %s from the Tailwind default theme",
    (selector) => {
      expect(css).not.toContain(`${selector} {`);
    },
  );

  it("makes clickable elements show a pointer (Tailwind v4 does not)", () => {
    // v4 の preflight は button に cursor: pointer を当てない。押せるものが矢印のままだと、
    // 押せることが見た目から分からない（画像の拡大表示で気づいた。ADR 0045）
    expect(css).toContain("button:not(:disabled)");
    expect(css).toMatch(/button:not\(:disabled\),\s*\[role="button"\],\s*summary\s*\{\s*cursor: pointer;/);
  });

  it("caps the composer at a number of lines, not a number of pixels (ADR 0048)", () => {
    const start = css.indexOf(".composer-lines {");
    expect(start).toBeGreaterThan(-1);
    expect(customPropertiesIn(css, ":root, :host")).toContain("--composer-max-lines");

    // 行送りや文字サイズを変えても「16 行ぶん」の意味が保たれるように lh で書く
    expect(css.slice(start, css.indexOf("}", start))).toContain(
      "max-height: calc(var(--composer-max-lines) * 1lh + var(--spacing) * 2)",
    );
  });

  describe("伸縮できるエリア（ADR 0048）", () => {
    it.each(["sidebar", "members", "thread"] as const)("clamps the width of %s between its own limits", (pane) => {
      const start = css.indexOf(`.md\\:pane-${pane}`);
      expect(start).toBeGreaterThan(-1);

      // 既定・最小・最大はすべて変数を経由する（幅の生の値をユーティリティに書かない）
      expect(css.slice(start, css.indexOf("}", start))).toContain(
        `width: clamp(var(--pane-${pane}-min), var(--pane-${pane}), var(--pane-${pane}-max))`,
      );
    });

    it("keeps every default and limit in this file", () => {
      const root = customPropertiesIn(css, ":root, :host");

      for (const pane of ["sidebar", "members", "thread"]) {
        expect(root).toContain(`--pane-${pane}`);
        expect(root).toContain(`--pane-${pane}-min`);
        expect(root).toContain(`--pane-${pane}-max`);
      }
    });
  });

  it("uses raw colors only in token definitions", () => {
    // トークンの定義行（--name: value;）以外に色の生の値が書かれていないこと
    const rawColors = source
      .split("\n")
      .filter((line) => !/^\s*--[a-z0-9-]+:/.test(line))
      .filter((line) => /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(/i.test(line));

    expect(rawColors).toEqual([]);
  });
});
