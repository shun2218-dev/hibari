// @vitest-environment node
/**
 * デザインの決まりごと（CLAUDE.md「デザイン」）をソースに対して検査する。
 * レビューで目視するより先に、トークンを経由しない値が入り込んだことに気づけるようにする。
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const webRoot = path.join(import.meta.dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

const files = [...sourceFiles(path.join(webRoot, "components")), ...sourceFiles(path.join(webRoot, "app"))];

// className に書かれる文字列リテラルの中身を取り出す（"..." と `...` の両方）
function classStrings(source: string): string[] {
  return [...source.matchAll(/"([^"\n]*)"|`([^`]*)`/g)].map((m) => m[1] ?? m[2]);
}

describe("design rules", () => {
  it("finds source files to check", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(files.map((file) => [path.relative(webRoot, file), file]))("%s uses no Tailwind arbitrary values", (_name, file) => {
    // text-[#2F6F62] や p-[13px]、outline-offset-[-2px] のような任意値。トークンに置き換える
    const offenders = classStrings(readFileSync(file, "utf8")).filter((s) => /(^|\s)[a-z:-]+-\[[^\]]+\]/.test(s));

    expect(offenders).toEqual([]);
  });

  it.each(files.map((file) => [path.relative(webRoot, file), file]))("%s writes no raw colors", (_name, file) => {
    const offenders = readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(/i.test(line));

    expect(offenders).toEqual([]);
  });

  it.each(files.map((file) => [path.relative(webRoot, file), file]))("%s uses no Tailwind default palette", (_name, file) => {
    // 既定テーマは捨ててあるので生成されないが、書いてしまうと見た目が崩れたまま気づきにくい
    const offenders = classStrings(readFileSync(file, "utf8")).filter((s) =>
      /(^|\s)(?:[a-z]+:)*(?:bg|text|border|ring|outline|fill|stroke)-(?:red|blue|green|gray|slate|zinc|neutral|stone|amber|yellow|emerald|white|black)(?:-\d+)?(\s|$)/.test(s),
    );

    expect(offenders).toEqual([]);
  });
});
