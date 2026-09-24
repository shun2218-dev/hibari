import { describe, expect, it } from "vitest";

import mentionCases from "@testdata/format/mentions.json";

import { type Block, type Inline, parseBody, parseInline } from "./body-format";

const ULID = "01J8ZZZZZZZZZZZZZZZZZZZZZA";

const text = (t: string): Inline => ({ type: "text", text: t });
const bold = (...children: Inline[]): Inline => ({ type: "bold", children });
const italic = (...children: Inline[]): Inline => ({ type: "italic", children });
const strike = (...children: Inline[]): Inline => ({ type: "strike", children });
const underline = (...children: Inline[]): Inline => ({ type: "underline", children });
const code = (t: string): Inline => ({ type: "code", text: t });
const link = (url: string): Inline => ({ type: "link", url });
const para = (...children: Inline[]): Block => ({ type: "paragraph", children });

describe("parseInline（ADR 0051 決定 2）", () => {
  it.each<[string, string, Inline[]]>([
    ["書式のない文はそのまま", "おはようございます", [text("おはようございます")]],
    ["太字", "*太字*", [bold(text("太字"))]],
    ["斜体", "_斜体_", [italic(text("斜体"))]],
    ["取り消し", "~取り消し~", [strike(text("取り消し"))]],
    ["インラインコード", "`x = 1`", [code("x = 1")]],
    ["日本語の文中でも効く（日本語の文字は境界）", "これは*太字*です", [text("これは"), bold(text("太字")), text("です")]],
    ["英単語の間の空白の後なら効く", "a *b* c", [text("a "), bold(text("b")), text(" c")]],
    ["識別子の _ は書式にしない", "snake_case_name", [text("snake_case_name")]],
    ["英数字に挟まれた * は書式にしない", "2*3*4", [text("2*3*4")]],
    ["開く記号の直後が空白なら書式にしない", "2 * 3 * 4", [text("2 * 3 * 4")]],
    ["閉じる記号の直前が空白なら書式にしない", "*a *", [text("*a *")]],
    ["閉じる記号の直後が英数字なら閉じない", "*a*b", [text("*a*b")]],
    ["閉じていない記号はただの文字", "*太字", [text("*太字")]],
    ["記号だけが続くものは書式にしない", "**", [text("**")]],
    ["入れ子にできる", "*_両方_*", [bold(italic(text("両方")))]],
    ["句読点は境界", "（*注意*）。", [text("（"), bold(text("注意")), text("）。")]],
    ["書式は行をまたがない", "*1 行目\n2 行目*", [text("*1 行目\n2 行目*")]],
    ["コードの中は解釈しない", "`*a* <!here>`", [code("*a* <!here>")]],
    ["コードの中の記号では閉じない", "*a `*` b*", [bold(text("a "), code("*"), text(" b"))]],
    ["中身が空のバッククォートはコードにしない", "``", [text("``")]],
    ["閉じていないバッククォートはただの文字", "`a", [text("`a")]],
    ["コードは行をまたがない", "`a\nb`", [text("`a\nb`")]],
    [
      "個人のメンション",
      `<@${ULID}> おはよう`,
      [{ type: "mention", kind: "user", id: ULID, raw: `<@${ULID}>` }, text(" おはよう")],
    ],
    ["@channel と @here", "<!channel><!here>", [
      { type: "mention", kind: "channel", raw: "<!channel>" },
      { type: "mention", kind: "here", raw: "<!here>" },
    ]],
    ["太字の中のメンション", "*<!here>*", [bold({ type: "mention", kind: "here", raw: "<!here>" })]],
    [
      "チャンネルへのリンク（ADR 0062）",
      `<#${ULID}> を見て`,
      [{ type: "channel", id: ULID, raw: `<#${ULID}>` }, text(" を見て")],
    ],
    ["太字の中のチャンネル", `*<#${ULID}>*`, [bold({ type: "channel", id: ULID, raw: `<#${ULID}>` })]],
    ["コードの中のチャンネルは解釈しない", `\`<#${ULID}>\``, [code(`<#${ULID}>`)]],
    ["ID の長さが違う <#…> はただの文字", "<#general> <#01J8>", [text("<#general> <#01J8>")]],
    ["トークンに見えない文字列はそのまま", "@alice <@01J8> <!everyone>", [text("@alice <@01J8> <!everyone>")]],
    ["<script> はただの文字", "<script>alert(1)</script>", [text("<script>alert(1)</script>")]],
  ])("%s", (_name, input, want) => {
    expect(parseInline(input)).toEqual(want);
  });
});

describe("下線（ADR 0051 の下線の追記）", () => {
  it.each<[string, string, Inline[]]>([
    ["下線", "__下線__", [underline(text("下線"))]],
    ["日本語の文中でも効く", "ここは__大事__です", [text("ここは"), underline(text("大事")), text("です")]],
    ["英数字に挟まれた __ は書式にしない", "a__b__c", [text("a__b__c")]],
    // 行頭や空白の後に単独で書いた `__init__` は、境界の規則どおり下線になる（コードとして書くならバッククォートで囲む）
    ["単独の __init__ は下線になる", "__init__", [underline(text("init"))]],
    ["斜体の中の下線", "_a __b__ c_", [italic(text("a "), underline(text("b")), text(" c"))]],
    ["下線の中の太字", "__*両方*__", [underline(bold(text("両方")))]],
    ["閉じていない下線はただの文字", "__下線", [text("__下線")]],
  ])("%s", (_name, input, want) => {
    expect(parseInline(input)).toEqual(want);
  });
});

describe("文字付きのリンク（ADR 0051 決定 4 の追記）", () => {
  const labeled = (url: string, label: string): Inline => ({ type: "link", url, label });
  it.each<[string, string, Inline[]]>([
    ["文字付きのリンク", "<https://example.com/docs|手順書>", [labeled("https://example.com/docs", "手順書")]],
    ["文中に置ける", "詳しくは<https://example.com|こちら>へ", [text("詳しくは"), labeled("https://example.com", "こちら"), text("へ")]],
    ["太字の中に置ける", "*<https://example.com|大事なリンク>*", [bold(labeled("https://example.com", "大事なリンク"))]],
    ["文字の中は解釈しない", "<https://example.com|*太字* _斜体_>", [labeled("https://example.com", "*太字* _斜体_")]],
    ["http / https でなければただの文字", "<javascript:alert(1)|押して>", [text("<javascript:alert(1)|押して>")]],
    [
      "文字にバッククォートがあれば文字付きのリンクにしない（コードとして読む）",
      "<https://example.com|a`b>`",
      [text("<"), link("https://example.com|a"), code("b>")],
    ],
    [
      "文字に < があれば文字付きのリンクにしない",
      "<https://example.com|a <!here>>",
      [text("<"), link("https://example.com|a"), text(" "), { type: "mention", kind: "here", raw: "<!here>" }, text(">")],
    ],
    ["文字が空なら文字付きのリンクにしない", "<https://example.com|>", [text("<"), link("https://example.com|"), text(">")]],
    ["コードの中は解釈しない", "`<https://example.com|x>`", [code("<https://example.com|x>")]],
  ])("%s", (_name, input, want) => {
    expect(parseInline(input)).toEqual(want);
  });
});

describe("URL のリンク（ADR 0051 決定 4）", () => {
  it.each<[string, string, Inline[]]>([
    ["https", "https://example.com/a?b=1", [link("https://example.com/a?b=1")]],
    ["http", "http://example.com", [link("http://example.com")]],
    ["日本語の文字で終わる", "https://example.comを見て", [link("https://example.com"), text("を見て")]],
    ["空白で終わる", "見て https://example.com です", [text("見て "), link("https://example.com"), text(" です")]],
    ["末尾の句読点と閉じ括弧は含めない", "（https://example.com/x）。", [text("（"), link("https://example.com/x"), text("）。")]],
    ["英語の句点も含めない", "See https://example.com.", [text("See "), link("https://example.com"), text(".")]],
    ["太字で囲んだ URL", "*https://example.com*", [bold(link("https://example.com"))]],
    ["URL の中の _ で斜体にしない", "_https://example.com/a_b_", [italic(link("https://example.com/a_b"))]],
    ["< > で終わる", "<https://example.com>", [text("<"), link("https://example.com"), text(">")]],
    ["javascript: はリンクにしない", "javascript:alert(1)", [text("javascript:alert(1)")]],
    ["英数字の直後からは始めない", "xhttps://example.com", [text("xhttps://example.com")]],
    ["スキームだけはリンクにしない", "https://", [text("https://")]],
    ["コードの中はリンクにしない", "`https://example.com`", [code("https://example.com")]],
  ])("%s", (_name, input, want) => {
    expect(parseInline(input)).toEqual(want);
  });
});

describe("parseBody（ブロック）", () => {
  it("書式のない本文は段落 1 つ。空行も改行として残す（既存のメッセージの見た目を変えない）", () => {
    expect(parseBody("1 行目\n\n3 行目")).toEqual([para(text("1 行目\n\n3 行目"))]);
  });

  it("空の本文は空の段落", () => {
    expect(parseBody("")).toEqual([para()]);
  });

  it("コードブロック。フェンスの前後の改行は記号の一部として落とす", () => {
    expect(parseBody("前\n```\nconst a = 1;\n*b*\n```\n後")).toEqual([
      para(text("前")),
      { type: "code", text: "const a = 1;\n*b*" },
      para(text("後")),
    ]);
  });

  it("1 行のコードブロック", () => {
    expect(parseBody("```x = 1```")).toEqual([{ type: "code", text: "x = 1" }]);
  });

  it("閉じていないフェンスはただの文字", () => {
    expect(parseBody("```\nまだ途中")).toEqual([para(text("```\nまだ途中"))]);
  });

  it("コードブロックの中の引用やリストの記号は解釈しない", () => {
    expect(parseBody("```\n> a\n- b\n```")).toEqual([{ type: "code", text: "> a\n- b" }]);
  });

  it("引用は続く行をまとめ、中も解釈する", () => {
    expect(parseBody("> *1*\n> 2\n本文")).toEqual([
      { type: "quote", children: [para(bold(text("1")), text("\n2"))] },
      para(text("本文")),
    ]);
  });

  it("> の直後に空白のない行は引用にしない", () => {
    expect(parseBody(">a")).toEqual([para(text(">a"))]);
  });

  it("箇条書き（- * •）", () => {
    expect(parseBody("- a\n* b\n• c")).toEqual([
      {
        type: "list",
        ordered: false,
        items: ["a", "b", "c"].map((t) => ({ number: null, children: [text(t)], sublists: [] })),
      },
    ]);
  });

  it("番号付きリストは書いた番号を持つ", () => {
    expect(parseBody("3. a\n4. b")).toEqual([
      {
        type: "list",
        ordered: true,
        items: [
          { number: 3, children: [text("a")], sublists: [] },
          { number: 4, children: [text("b")], sublists: [] },
        ],
      },
    ]);
  });

  it("空白 2 つで 1 段深くなり、3 段で止まる", () => {
    const [list] = parseBody("- 1\n  - 2\n    - 3\n      - 4\n- 5");
    expect(list).toMatchObject({
      type: "list",
      items: [
        {
          children: [text("1")],
          sublists: [
            {
              items: [
                {
                  children: [text("2")],
                  sublists: [{ items: [{ children: [text("3")] }, { children: [text("4")] }] }],
                },
              ],
            },
          ],
        },
        { children: [text("5")] },
      ],
    });
  });

  it("いきなり 2 段下げても 1 段だけ深くする", () => {
    const [list] = parseBody("- 1\n    - 2");
    expect(list).toMatchObject({ items: [{ sublists: [{ items: [{ children: [text("2")] }] }] }] });
  });

  it("同じ段で番号の有無が変わったら別のリスト", () => {
    expect(parseBody("- a\n1. b").map((b) => b.type === "list" && b.ordered)).toEqual([false, true]);
  });

  it("行頭の *太字* はリストにしない（記号の後ろに空白がない）", () => {
    expect(parseBody("*太字*")).toEqual([para(bold(text("太字")))]);
  });
});

/** 木の中のメンションのトークンを、出現順・重複なしで集める（コードの中は木に入らない）。 */
function mentionTokens(blocks: Block[]): string[] {
  const found: string[] = [];
  const inline = (nodes: Inline[]) => {
    for (const node of nodes) {
      if (node.type === "mention") found.push(node.raw);
      else if ("children" in node) inline(node.children);
    }
  };
  const block = (b: Block) => {
    if (b.type === "paragraph") inline(b.children);
    else if (b.type === "quote") b.children.forEach(block);
    else if (b.type === "list")
      for (const item of b.items) {
        inline(item.children);
        item.sublists.forEach(block);
      }
  };
  blocks.forEach(block);
  return [...new Set(found)];
}

describe("サーバーと共通のメンションの例（ADR 0051 決定 5）", () => {
  // サーバー（internal/chat/mention）のテストも同じファイルを読む。コードの範囲の規則がずれると、どちらかが落ちる
  const file: { cases: { name: string; body: string; mentions: string[] }[] } = mentionCases;

  it("例がある", () => {
    expect(file.cases.length).toBeGreaterThan(0);
  });

  it.each(file.cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    expect(mentionTokens(parseBody(c.body))).toEqual(c.mentions);
  });
});
