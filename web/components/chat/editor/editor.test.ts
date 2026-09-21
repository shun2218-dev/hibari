import { createHeadlessEditor } from "@lexical/headless";
import { $createLinkNode } from "@lexical/link";
import { $createParagraphNode, $createTextNode, $getRoot, type LexicalEditor, type TextFormatType } from "lexical";
import { describe, expect, it } from "vitest";

import { parseBody } from "@/lib/chat/body-format";

import { $exportBody } from "./export";
import { $importBody } from "./import";
import { $createMentionNode, $isMentionNode } from "./mention-node";
import { editorNodes } from "./nodes";

const ALICE = "01J8ZZZZZZZZZZZZZZZZZZZZZA";
const names = { [ALICE]: "田中 あおい" };

function editor(): LexicalEditor {
  return createHeadlessEditor({
    nodes: [...editorNodes],
    onError: (error) => {
      throw error;
    },
  });
}

/** 本文を読み込んで、そのまま書き出す。 */
function roundTrip(body: string): string {
  const e = editor();
  e.update(() => $importBody(body, names), { discrete: true });
  return e.getEditorState().read(() => $exportBody());
}

/** 入力欄で作った中身を書き出す（書き出しだけを確かめる）。 */
function exportOf(build: () => void): string {
  const e = editor();
  e.update(build, { discrete: true });
  return e.getEditorState().read(() => $exportBody());
}

function paragraph(...parts: [string, TextFormatType[]?][]) {
  const p = $createParagraphNode();
  for (const [text, formats = []] of parts) {
    const node = $createTextNode(text);
    for (const f of formats) node.toggleFormat(f);
    p.append(node);
  }
  $getRoot().clear().append(p);
}

describe("読み込んで書き出すと、同じ本文に戻る（ADR 0052 決定 2）", () => {
  it.each([
    ["書式のない本文", "おはようございます"],
    ["改行と空行", "1 行目\n\n3 行目"],
    ["太字・斜体・下線・取り消し", "*太字* と _斜体_ と __下線__ と ~取り消し~"],
    ["日本語の文中の書式", "これは*太字*です"],
    ["入れ子の書式", "*_両方_*"],
    ["インラインコード", "`make migrate` を流す"],
    ["URL", "資料は https://example.com/docs です"],
    ["文字付きのリンク", "手順は<https://example.com/docs|手順書>にあります"],
    ["個人のメンション", `<@${ALICE}> おはよう`],
    ["全員宛て", "<!channel> と <!here>"],
    ["名前を引けない ID はトークンのまま", "<@01J8YYYYYYYYYYYYYYYYYYYYYY> だれ"],
    ["コードブロック", "前\n```\nconst a = *b*;\n  <!here>\n```\n後"],
    ["引用", "> 引用の 1 行目\n> *2 行目*\n本文"],
    ["箇条書き", "- a\n- *b*"],
    ["番号付きリスト（3 から）", "3. a\n4. b"],
    ["入れ子のリスト", "- 1\n  - 2\n    - 3\n- 4"],
    ["引用の中のリスト", "> - a\n> - b"],
  ])("%s", (_name, body) => {
    expect(roundTrip(body)).toBe(body);
  });

  it.each([
    // 記号の違いや 1 行のコードブロックは、同じ意味の決まった形にそろう
    ["* と • の箇条書きは - になる", "* a\n• b", "- a\n- b"],
    ["1 行のコードブロックは行を分ける", "```x = 1```", "```\nx = 1\n```"],
  ])("%s", (_name, body, want) => {
    const got = roundTrip(body);
    expect(got).toBe(want);
    expect(parseBody(got)).toEqual(parseBody(want));
  });
});

describe("読み込み", () => {
  it("メンションは分けられないノードになり、@名前 を出す", () => {
    const e = editor();
    e.update(() => $importBody(`<@${ALICE}> と <!here>`, names), { discrete: true });
    const mentions = e.getEditorState().read(() =>
      $getRoot()
        .getAllTextNodes()
        .filter($isMentionNode)
        .map((n) => [n.getTextContent(), n.getMode()]),
    );
    expect(mentions).toEqual([
      ["@田中 あおい", "token"],
      ["@here", "token"],
    ]);
  });

  it("空の本文は空の段落 1 つ", () => {
    const e = editor();
    e.update(() => $importBody(""), { discrete: true });
    expect(e.getEditorState().read(() => $getRoot().getChildrenSize())).toBe(1);
    expect(e.getEditorState().read(() => $exportBody())).toBe("");
  });
});

describe("書き出し（入力欄で作った中身）", () => {
  it("書式の端の空白は記号の外に出す", () => {
    expect(exportOf(() => paragraph(["太字 ", ["bold"]], ["のあと"]))).toBe("*太字* のあと");
  });

  it("英単語の途中だけの太字は、記法で書けないので書式を落とす", () => {
    expect(exportOf(() => paragraph(["x"], ["abc", ["bold"]], ["y"]))).toBe("xabcy");
  });

  it("隣り合う文字で書式が変わっても、入れ子を保つ", () => {
    expect(exportOf(() => paragraph(["太字", ["bold"]], ["と斜体", ["bold", "italic"]]))).toBe("*太字_と斜体_*");
  });

  it("下線と斜体が隣り合って記法で書けないときは、読める形になるまで書式を外す", () => {
    // `___両方___` は ADR 0051 の記法で読めない。書式を 1 つずつ外して試し、斜体だけを残す
    expect(exportOf(() => paragraph(["両方", ["underline", "italic"]]))).toBe("_両方_");
    // 斜体の直後の下線も `_` が 3 つ続いてしまうので、下線を外す（書けない書式は落とす。ADR 0052 決定 2）
    expect(exportOf(() => paragraph(["前", ["italic"]], ["後", ["underline"]]))).toBe("_前_後");
  });

  it("空白をまたぐ入れ子も書ける", () => {
    expect(exportOf(() => paragraph(["a ", ["bold"]], ["b", ["bold", "strikethrough"]], [" c"]))).toBe("*a ~b~* c");
  });

  it("バッククォートを含むインラインコードはコードにしない", () => {
    expect(exportOf(() => paragraph(["a`b", ["code"]]))).toBe("a`b");
  });

  it("文字付きのリンクの文字に書けない文字があれば URL だけにする", () => {
    expect(
      exportOf(() => {
        const link = $createLinkNode("https://example.com").append($createTextNode("a <b>"));
        $getRoot().clear().append($createParagraphNode().append(link));
      }),
    ).toBe("https://example.com");
  });

  it("http / https でないリンクは文字だけにする", () => {
    expect(
      exportOf(() => {
        const link = $createLinkNode("javascript:alert(1)").append($createTextNode("押して"));
        $getRoot().clear().append($createParagraphNode().append(link));
      }),
    ).toBe("押して");
  });

  it("メンションはトークンで書き出す", () => {
    expect(
      exportOf(() => {
        $getRoot()
          .clear()
          .append($createParagraphNode().append($createMentionNode(`<@${ALICE}>`, "@田中 あおい"), $createTextNode(" よろしく")));
      }),
    ).toBe(`<@${ALICE}> よろしく`);
  });
});
