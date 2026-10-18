import { describe, expect, it } from "vitest";

import { highlightParts, normalizeForSearch } from "@/lib/chat/format/highlight";

/** 塗られたところだけを取り出す（見た目の確認をしやすくするため）。 */
const hits = (text: string, terms: string[]) =>
  highlightParts(text, terms)
    .filter((p) => p.hit)
    .map((p) => p.text);

/** 断片をつなぐと元の本文に戻る（文字を落とさない・増やさない）。 */
const joined = (text: string, terms: string[]) =>
  highlightParts(text, terms)
    .map((p) => p.text)
    .join("");

describe("normalizeForSearch", () => {
  it("NFKC と小文字にそろえる（サーバーの索引の式と同じ）", () => {
    expect(normalizeForSearch("Ｄｅｐｌｏｙ")).toBe("deploy");
    expect(normalizeForSearch("ﾒｯｾｰｼﾞ")).toBe("メッセージ");
  });
});

describe("highlightParts", () => {
  it("一致がなければ本文をそのまま 1 つ返す", () => {
    expect(highlightParts("面談の日程", ["リリース"])).toEqual([{ text: "面談の日程", hit: false }]);
  });

  it("検索語が空なら塗らない", () => {
    expect(highlightParts("面談", [])).toEqual([{ text: "面談", hit: false }]);
    expect(highlightParts("面談", ["", "  ".trim()])).toEqual([{ text: "面談", hit: false }]);
  });

  it("本文が空なら断片も空", () => {
    expect(highlightParts("", ["面談"])).toEqual([]);
  });

  it("2 文字の日本語を塗る", () => {
    expect(highlightParts("明日の面談の資料", ["面談"])).toEqual([
      { text: "明日の", hit: false },
      { text: "面談", hit: true },
      { text: "の資料", hit: false },
    ]);
  });

  it("大文字小文字と全角半角の違いを吸収する（サーバーと同じ見つけ方）", () => {
    expect(hits("Deploy が終わりました", ["deploy"])).toEqual(["Deploy"]);
    expect(hits("deploy が終わりました", ["Ｄｅｐｌｏｙ"])).toEqual(["deploy"]);
  });

  it("正規化で文字数が変わっても、元の本文の位置で切り出す", () => {
    // ㈱ は NFKC で「(株)」の 3 文字になる。対応表がないと切り出す位置がずれる
    const text = "㈱ほしの の面談";
    expect(joined(text, ["面談"])).toBe(text);
    expect(hits(text, ["面談"])).toEqual(["面談"]);
    expect(hits(text, ["(株)"])).toEqual(["㈱"]);
  });

  it("同じ語が何度も出てきたら全部塗る", () => {
    expect(hits("面談と面談", ["面談"])).toEqual(["面談", "面談"]);
  });

  it("重なった一致は 1 つにまとめる", () => {
    // 「ああ」は「あああ」の中で 2 か所に当たり、範囲が重なる
    expect(highlightParts("あああ", ["ああ"])).toEqual([{ text: "あああ", hit: true }]);
  });

  it("複数の検索語（AND）をどちらも塗る", () => {
    expect(hits("面談の資料を共有します", ["面談", "資料"])).toEqual(["面談", "資料"]);
  });

  it("隣り合う一致をつないで、塗りを途切れさせない", () => {
    expect(highlightParts("面談資料", ["面談", "資料"])).toEqual([{ text: "面談資料", hit: true }]);
  });

  it("絵文字（サロゲートペア）を割らない", () => {
    const text = "🎉 面談 🎉";
    expect(joined(text, ["面談"])).toBe(text);
    expect(hits(text, ["🎉"])).toEqual(["🎉", "🎉"]);
  });
});
