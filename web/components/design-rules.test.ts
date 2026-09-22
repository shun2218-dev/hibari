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

// 描画するのは components/ と app/ だけでなく、要素を返すフック（hooks/）と Provider（providers/）もある（ADR 0060）
const files = ["components", "app", "hooks", "providers"].flatMap((dir) => sourceFiles(path.join(webRoot, dir)));

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

  // チャットの画面は、ユーザーが書いた文字列を出す。HTML として埋め込まず、React のテキストとして出せば <script> は文字のまま見える
  // （ADR 0051 決定 3）。app/layout.tsx の head のスクリプト（固定の文字列）は対象の外
  const chatFiles = files.filter((file) => file.startsWith(path.join(webRoot, "components", "chat") + path.sep));

  it("finds chat components to check for HTML strings", () => {
    expect(chatFiles.length).toBeGreaterThan(10);
  });

  it.each(chatFiles.map((file) => [path.relative(webRoot, file), file]))("%s embeds no HTML strings", (_name, file) => {
    expect(readFileSync(file, "utf8")).not.toMatch(/dangerouslySetInnerHTML|\.innerHTML\s*=/);
  });

  // Lexical は 1.0 前で破壊的変更が続くので、import する場所を 1 つに限る（ADR 0052 決定 1）
  const editorDir = path.join(webRoot, "components", "chat", "editor") + path.sep;
  const libFiles = sourceFiles(path.join(webRoot, "lib"));

  it.each([...files, ...libFiles].filter((file) => !file.startsWith(editorDir)).map((file) => [path.relative(webRoot, file), file]))(
    "%s does not import Lexical outside components/chat/editor",
    (_name, file) => {
      expect(readFileSync(file, "utf8")).not.toMatch(/from "(lexical|@lexical\/[^"]+)"/);
    },
  );
});
