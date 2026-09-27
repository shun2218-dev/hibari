import { describe, expect, it } from "vitest";

import {
  buildHuddleLink,
  buildPermalink,
  CARD_CLAMP_CHARS,
  CARD_CLAMP_LINES,
  clampCardBody,
  findHuddleLinks,
  findPermalinks,
  huddleLinkPath,
  linkKey,
  MAX_LINK_CARDS,
  parseHuddleLink,
  parsePermalink,
  permalinkPath,
  withSide,
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

  it("文字付きのリンクのパーマリンクもカードにする（ADR 0051 決定 4 の追記）", () => {
    expect(findPermalinks(`<${permalink}|この発言>`, ORIGIN)).toEqual([{ workspaceId: WS, roomId: ROOM, messageId: MSG }]);
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

describe("withSide（ADR 0058 決定 1）", () => {
  it("クエリに side を足し、ほかのクエリは残す。ホームは付けない", () => {
    expect(withSide("/w/ws-1/r/r1", "activity")).toBe("/w/ws-1/r/r1?side=activity");
    expect(withSide("/w/ws-1/r/r1?m=m-2&t=m-1", "later")).toBe("/w/ws-1/r/r1?m=m-2&t=m-1&side=later");
    expect(withSide("/w/ws-1/r/r1?side=dms", "activity")).toBe("/w/ws-1/r/r1?side=activity");
    expect(withSide("/w/ws-1/r/r1", "home")).toBe("/w/ws-1/r/r1");
  });
});


describe("ハドルへのリンク（ADR 0067 決定 1・2）", () => {
  const origin = "https://hibari.test";
  const ws = "01J8ZH5K000000000000000001";
  const room = "01J8ZH5K000000000000000002";
  const msg = "01J8ZH5K000000000000000003";

  it("ルームの URL に huddle=1 を足した形で組み立て、読み戻せる", () => {
    const href = buildHuddleLink(origin, { workspaceId: ws, roomId: room });
    expect(href).toBe(`${origin}/w/${ws}/r/${room}?huddle=1`);
    expect(parseHuddleLink(href, origin)).toEqual({ workspaceId: ws, roomId: room });
    expect(huddleLinkPath({ workspaceId: ws, roomId: room })).toBe(`/w/${ws}/r/${room}?huddle=1`);
  });

  it.each([
    ["別のオリジン", `https://other.test/w/${ws}/r/${room}?huddle=1`],
    ["huddle がない", `${origin}/w/${ws}/r/${room}`],
    ["メッセージへのリンク", `${origin}/w/${ws}/r/${room}?huddle=1&m=${msg}`],
    ["ID でない", `${origin}/w/x/r/${room}?huddle=1`],
    ["後ろにパスが続く", `${origin}/w/${ws}/r/${room}/x?huddle=1`],
  ])("%s は受けない", (_name, href) => {
    expect(parseHuddleLink(href, origin)).toBeNull();
  });

  it("本文から出てきた順に集め、同じルームはまとめ、メッセージのカードと合わせて 3 枚まで", () => {
    const room2 = "01J8ZH5K000000000000000004";
    const room3 = "01J8ZH5K000000000000000005";
    const h = (r: string) => `${origin}/w/${ws}/r/${r}?huddle=1`;
    expect(findHuddleLinks(`${h(room)} ${h(room)} ${h(room2)}`, origin).map((l) => l.roomId)).toEqual([room, room2]);
    // メッセージへのリンクが 2 つあれば、ハドルのカードは 1 枚だけ
    const permalinks = `${origin}/w/${ws}/r/${room}?m=${msg} ${origin}/w/${ws}/r/${room2}?m=${msg}`;
    expect(findHuddleLinks(`${permalinks} ${h(room)} ${h(room3)}`, origin).map((l) => l.roomId)).toEqual([room]);
  });
});
