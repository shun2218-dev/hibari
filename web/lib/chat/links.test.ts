import { describe, expect, it } from "vitest";

import {
  CARD_CLAMP_CHARS,
  CARD_CLAMP_LINES,
  MAX_LINK_CARDS,
  buildPermalink,
  clampCardBody,
  findPermalinks,
  linkKey,
  parsePermalink,
  permalinkPath,
} from "./links";

const ORIGIN = "https://hibari.example";
const WS = "01J9ZQZQZQZQZQZQZQZQZQZQZA";
const ROOM = "01J9ZQZQZQZQZQZQZQZQZQZQZB";
const MSG = "01J9ZQZQZQZQZQZQZQZQZQZQZC";
const ROOT = "01J9ZQZQZQZQZQZQZQZQZQZQZD";

const permalink = `${ORIGIN}/w/${WS}/r/${ROOM}?m=${MSG}`;

describe("buildPermalink", () => {
  it("ルームの画面の URL にクエリを足した形にする", () => {
    expect(buildPermalink(ORIGIN, { workspaceId: WS, roomId: ROOM, messageId: MSG })).toBe(permalink);
  });

  it("スレッドの返信には親の ID を足す", () => {
    const href = buildPermalink(ORIGIN, { workspaceId: WS, roomId: ROOM, messageId: MSG, threadRootId: ROOT });
    expect(href).toBe(`${permalink}&t=${ROOT}`);
  });

  it("組み立てた URL は、そのまま読み戻せる", () => {
    const link = { workspaceId: WS, roomId: ROOM, messageId: MSG, threadRootId: ROOT };
    expect(parsePermalink(buildPermalink(ORIGIN, link), ORIGIN)).toEqual(link);
  });
});

describe("permalinkPath", () => {
  it("同じ行き先を、アプリの中のパスで返す（カードの遷移先。ADR 0042）", () => {
    expect(permalinkPath({ workspaceId: WS, roomId: ROOM, messageId: MSG })).toBe(`/w/${WS}/r/${ROOM}?m=${MSG}`);
    expect(permalinkPath({ workspaceId: WS, roomId: ROOM, messageId: MSG, threadRootId: ROOT })).toBe(
      `/w/${WS}/r/${ROOM}?m=${MSG}&t=${ROOT}`,
    );
  });

  it("コピーする URL と同じ所を指す", () => {
    const link = { workspaceId: WS, roomId: ROOM, messageId: MSG, threadRootId: ROOT };
    expect(new URL(permalinkPath(link), ORIGIN).toString()).toBe(buildPermalink(ORIGIN, link));
  });
});

describe("parsePermalink", () => {
  it("パーマリンクを読む", () => {
    expect(parsePermalink(permalink, ORIGIN)).toEqual({ workspaceId: WS, roomId: ROOM, messageId: MSG });
  });

  it("スレッドの返信の親を読む", () => {
    expect(parsePermalink(`${permalink}&t=${ROOT}`, ORIGIN)).toEqual({
      workspaceId: WS,
      roomId: ROOM,
      messageId: MSG,
      threadRootId: ROOT,
    });
  });

  it("オリジンが違えば null（別のインスタンスの ID を自分のところに問い合わせない）", () => {
    expect(parsePermalink(`https://other.example/w/${WS}/r/${ROOM}?m=${MSG}`, ORIGIN)).toBeNull();
  });

  it.each([
    ["URL ではない", "ただの文章"],
    ["別のページ", `${ORIGIN}/w/${WS}/admin/members?m=${MSG}`],
    ["m がない", `${ORIGIN}/w/${WS}/r/${ROOM}`],
    ["パスが短い", `${ORIGIN}/w/${WS}?m=${MSG}`],
    ["パスが長い", `${ORIGIN}/w/${WS}/r/${ROOM}/x?m=${MSG}`],
    ["ルーム ID が ULID ではない", `${ORIGIN}/w/${WS}/r/not-a-ulid?m=${MSG}`],
    ["メッセージ ID が ULID ではない", `${ORIGIN}/w/${WS}/r/${ROOM}?m=nope`],
    ["ワークスペース ID が ULID ではない", `${ORIGIN}/w/nope/r/${ROOM}?m=${MSG}`],
    ["ULID に使えない文字（I）が入る", `${ORIGIN}/w/${WS}/r/${ROOM}?m=01J9ZQZQZQZQZQZQZQZQZQZQZI`],
    ["t が ULID ではない", `${ORIGIN}/w/${WS}/r/${ROOM}?m=${MSG}&t=nope`],
  ])("%s なら null", (_name, href) => {
    expect(parsePermalink(href, ORIGIN)).toBeNull();
  });

  it("オリジンが読めなければ null", () => {
    expect(parsePermalink(permalink, "")).toBeNull();
  });
});

describe("findPermalinks", () => {
  it("本文からリンクを出てきた順に見つける", () => {
    const other = `${ORIGIN}/w/${WS}/r/${ROOM}?m=${ROOT}`;
    expect(findPermalinks(`まずは ${other} を見て、それから ${permalink} です`, ORIGIN)).toEqual([
      { workspaceId: WS, roomId: ROOM, messageId: ROOT },
      { workspaceId: WS, roomId: ROOM, messageId: MSG },
    ]);
  });

  it("同じメッセージへのリンクは 1 つにまとめる", () => {
    expect(findPermalinks(`${permalink} と ${permalink}`, ORIGIN)).toHaveLength(1);
  });

  it("末尾の句読点や括弧は URL に含めない", () => {
    expect(findPermalinks(`これ（${permalink}）。`, ORIGIN)).toHaveLength(1);
    expect(findPermalinks(`${permalink}。`, ORIGIN)[0]?.messageId).toBe(MSG);
  });

  it(`カードは ${MAX_LINK_CARDS} 件で打ち切る`, () => {
    const ids = ["A", "B", "C", "D", "E"].map((c) => `01J9ZQZQZQZQZQZQZQZQZQZQZ${c}`);
    const body = ids.map((id) => `${ORIGIN}/w/${WS}/r/${ROOM}?m=${id}`).join(" ");
    const found = findPermalinks(body, ORIGIN);
    expect(found).toHaveLength(MAX_LINK_CARDS);
    // 打ち切っても、先頭から順に残す。
    expect(found.map((l) => l.messageId)).toEqual(ids.slice(0, MAX_LINK_CARDS));
  });

  it("コードの中のリンクはカードにしない（ADR 0051 決定 4）", () => {
    expect(findPermalinks(`\`${permalink}\` と\n\`\`\`\n${permalink}\n\`\`\``, ORIGIN)).toEqual([]);
  });

  it("日本語の文字の直前で URL を切る（ADR 0051 決定 4）", () => {
    expect(findPermalinks(`${permalink}を見て`, ORIGIN)).toEqual([{ workspaceId: WS, roomId: ROOM, messageId: MSG }]);
  });

  it("リンクのない本文では空", () => {
    expect(findPermalinks("ただの本文です https://example.com も混ざる", ORIGIN)).toEqual([]);
  });
});

describe("linkKey", () => {
  it("ルームとメッセージの組で覚える（認可はルームの単位なので、ルームが違えば別の結果）", () => {
    expect(linkKey({ roomId: ROOM, messageId: MSG })).toBe(`${ROOM}/${MSG}`);
    expect(linkKey({ roomId: ROOT, messageId: MSG })).not.toBe(linkKey({ roomId: ROOM, messageId: MSG }));
  });
});

describe("clampCardBody", () => {
  it("短い本文はそのまま", () => {
    expect(clampCardBody("短い本文")).toEqual({ text: "短い本文", clamped: false });
  });

  it(`${CARD_CLAMP_LINES} 行までは畳まない`, () => {
    const body = Array.from({ length: CARD_CLAMP_LINES }, (_, i) => `${i + 1} 行目`).join("\n");
    expect(clampCardBody(body)).toEqual({ text: body, clamped: false });
  });

  it(`${CARD_CLAMP_LINES} 行を超えたら畳む`, () => {
    const body = Array.from({ length: CARD_CLAMP_LINES + 2 }, (_, i) => `${i + 1} 行目`).join("\n");
    const got = clampCardBody(body);
    expect(got.clamped).toBe(true);
    expect(got.text.split("\n")).toHaveLength(CARD_CLAMP_LINES);
    expect(got.text.endsWith("…")).toBe(true);
    expect(got.text).not.toContain(`${CARD_CLAMP_LINES + 1} 行目`);
  });

  it(`${CARD_CLAMP_CHARS} 文字を超えたら、1 行でも畳む`, () => {
    const body = "あ".repeat(CARD_CLAMP_CHARS + 1);
    const got = clampCardBody(body);
    expect(got.clamped).toBe(true);
    // 「…」の 1 文字を足しても、上限 + 1 文字に収まる。
    expect(got.text).toHaveLength(CARD_CLAMP_CHARS + 1);
  });

  it(`${CARD_CLAMP_CHARS} 文字ちょうどは畳まない`, () => {
    const body = "あ".repeat(CARD_CLAMP_CHARS);
    expect(clampCardBody(body).clamped).toBe(false);
  });

  it("行数も文字数も超えていたら、両方で切る", () => {
    const body = Array.from({ length: CARD_CLAMP_LINES + 2 }, () => "あ".repeat(100)).join("\n");
    const got = clampCardBody(body);
    expect(got.clamped).toBe(true);
    expect(got.text.length).toBeLessThanOrEqual(CARD_CLAMP_CHARS + 1);
  });

  it("畳んだ末尾に空白を残さない", () => {
    const body = `${Array.from({ length: CARD_CLAMP_LINES }, (_, i) => `${i + 1} 行目`).join("\n")}\n\n続き`;
    expect(clampCardBody(body).text.endsWith("行目…")).toBe(true);
  });

  it("コードブロックの途中で切ったら、閉じるフェンスを足す（ADR 0051 決定 3）", () => {
    const code = Array.from({ length: CARD_CLAMP_LINES + 2 }, (_, i) => `line ${i + 1}`).join("\n");
    const got = clampCardBody(`設定です\n\`\`\`\n${code}\n\`\`\``);
    expect(got.clamped).toBe(true);
    expect(got.text.endsWith("…\n```")).toBe(true);
    expect(got.text.split("```")).toHaveLength(3);
  });

  it("コードブロックの外で切ったら、フェンスを足さない", () => {
    const body = `\`\`\`a\`\`\`\n${Array.from({ length: CARD_CLAMP_LINES + 2 }, (_, i) => `${i + 1} 行目`).join("\n")}`;
    expect(clampCardBody(body).text.endsWith("行目…")).toBe(true);
  });
});
