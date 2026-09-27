import { describe, expect, it } from "vitest";

import type { MessageHuddle, RoomHuddle } from "@/lib/api/types.gen";
import { kei, miyuki, naoki, room } from "@/test/chat-data";

import {
  huddleDurationLabel,
  huddleHeaderState,
  huddleElapsedLabel,
  huddleLinkAction,
  huddleLinkCardTable,
  huddleLinkRoomsIn,
  huddleNavFaces,
  huddleParticipantNames,
  roomHuddleBadge,
  toBlockedHuddlePreviewView,
  toHuddleLinkCardViews,
  toHuddleListItemView,
  toHuddleOngoingCards,
  toHuddlePlaceOptions,
  toHuddleSuggestionView,
  toHuddleMessageView,
  toHuddlePreviewView,
  toHuddleScreenView,
} from "./huddles";

const names = { [naoki.id]: naoki.display_name, [miyuki.id]: miyuki.display_name, [kei.id]: kei.display_name };

function messageHuddle(overrides: Partial<MessageHuddle> = {}): MessageHuddle {
  return { id: "h-1", started_at: "2026-09-26T02:20:00Z", ended_at: null, participant_ids: [miyuki.id], ...overrides };
}

function roomHuddle(userIds: string[], overrides: Partial<RoomHuddle> = {}): RoomHuddle {
  return {
    id: "h-1",
    room_id: "room-1",
    message_id: "m-1",
    started_at: "2026-09-26T02:20:00Z",
    version: 1,
    participants: userIds.map((user_id) => ({ user_id, muted: false })),
    joining_soon: [],
    ...overrides,
  };
}

describe("huddleParticipantNames（ADR 0066 決定 12）", () => {
  it.each([
    [[miyuki.id], "高橋 みゆき"],
    [[miyuki.id, naoki.id], "あなた、高橋 みゆき"],
    [[miyuki.id, kei.id], "高橋 みゆき、森田 圭"],
    [[miyuki.id, kei.id, naoki.id, "u-4"], "あなた、高橋 みゆき、ほか 2 人"],
  ])("%j → %s（自分を先頭に、名前は 2 人まで）", (ids, want) => {
    expect(huddleParticipantNames(ids, naoki.id, names)).toBe(want);
  });
});

describe("huddleDurationLabel", () => {
  it.each([
    ["2026-09-26T02:20:30Z", "1 分未満"],
    ["2026-09-26T02:32:00Z", "12 分"],
    ["2026-09-26T03:20:00Z", "1 時間"],
    ["2026-09-26T03:25:59Z", "1 時間 5 分"],
  ])("終わりが %s なら「%s」", (endedAt, want) => {
    expect(huddleDurationLabel("2026-09-26T02:20:00Z", endedAt)).toBe(want);
  });
});

describe("toHuddleMessageView（ADR 0066 決定 12・追記 D）", () => {
  const base = { names, timeLabel: "11:20", me: naoki };

  it("進行中は、ルームの状態からいま入っている人を出す", () => {
    const view = toHuddleMessageView(
      { id: "m-1", sender: miyuki, huddle: messageHuddle({ participant_ids: [miyuki.id, kei.id] }) },
      { ...base, activeHuddle: roomHuddle([miyuki.id]) },
    );
    expect(view).toMatchObject({ state: "active", joined: false, participantsLabel: "高橋 みゆきが参加中" });
    expect(view.participants.map((p) => p.id)).toEqual([miyuki.id]);
  });

  it("自分が入っていれば joined にし、ラベルに「参加中」を付けない（部品が前に付ける）", () => {
    const view = toHuddleMessageView(
      { id: "m-1", sender: miyuki, huddle: messageHuddle() },
      { ...base, activeHuddle: roomHuddle([miyuki.id, naoki.id]) },
    );
    expect(view).toMatchObject({ state: "active", joined: true, participantsLabel: "あなた、高橋 みゆき" });
  });

  it("別のハドルの状態は使わず、一度でも入った人で代える", () => {
    const view = toHuddleMessageView(
      { id: "m-1", sender: miyuki, huddle: messageHuddle({ participant_ids: [miyuki.id, kei.id] }) },
      { ...base, activeHuddle: roomHuddle([naoki.id], { id: "h-2" }) },
    );
    expect(view.participants.map((p) => p.id)).toEqual([miyuki.id, kei.id]);
  });

  it("終わったら所要時間と参加した人を出す", () => {
    const ended = messageHuddle({ ended_at: "2026-09-26T02:32:00Z", participant_ids: [miyuki.id, kei.id, naoki.id, "u-4"] });
    expect(toHuddleMessageView({ id: "m-1", sender: miyuki, huddle: ended }, base)).toMatchObject({
      state: "ended",
      durationLabel: "12 分",
      participantsLabel: "あなた、高橋 みゆき、ほか 2 人が参加しました",
    });
    const alone = messageHuddle({ ended_at: "2026-09-26T02:22:00Z", participant_ids: [naoki.id] });
    expect(toHuddleMessageView({ id: "m-1", sender: naoki, huddle: alone }, base)).toMatchObject({
      state: "ended",
      participantsLabel: "あなたが 1 人で参加しました",
    });
  });

  it("DM で入らなかった人には不在着信、始めた人には応答なし", () => {
    const ended = messageHuddle({ ended_at: "2026-09-26T02:21:00Z", participant_ids: [miyuki.id] });
    expect(toHuddleMessageView({ id: "m-1", sender: miyuki, huddle: ended }, { ...base, roomKind: "dm" }).state).toBe("missed");
    const mine = messageHuddle({ ended_at: "2026-09-26T02:21:00Z", participant_ids: [naoki.id] });
    expect(toHuddleMessageView({ id: "m-1", sender: naoki, huddle: mine }, { ...base, roomKind: "dm" }).state).toBe("unanswered");
    // チャンネルでは不在着信にしない
    expect(toHuddleMessageView({ id: "m-1", sender: miyuki, huddle: ended }, { ...base, roomKind: "public" }).state).toBe("ended");
  });
});

describe("ヘッダーとサイドバー", () => {
  it("ヘッダーのボタンは、進行中でなければ idle、入っていなければ active、入っていれば joined", () => {
    expect(huddleHeaderState(room("r1", "雑談"), naoki.id, names)).toEqual({ state: "idle" });
    expect(huddleHeaderState(room("r1", "雑談", { huddle: roomHuddle([miyuki.id]) }), naoki.id, names)).toEqual({
      state: "active",
      participants: [{ id: miyuki.id, name: miyuki.display_name, avatarUrl: undefined }],
    });
    expect(huddleHeaderState(room("r1", "雑談", { huddle: roomHuddle([naoki.id]) }), naoki.id, names)).toEqual({ state: "joined" });
  });

  it("サイドバーの印は進行中のときだけ", () => {
    expect(roomHuddleBadge(room("r1", "雑談"), names)).toBeUndefined();
    expect(roomHuddleBadge(room("r1", "雑談", { huddle: roomHuddle([miyuki.id, kei.id]) }), names)?.participants.map((p) => p.name)).toEqual([
      miyuki.display_name,
      kei.display_name,
    ]);
  });
});

describe("toHuddlePreviewView（追記 B）", () => {
  const self = { id: naoki.id, name: naoki.display_name };
  const preview = { phase: "preview" as const, roomId: "room-1", micOn: true, mics: [{ id: "m", label: "マイク" }], micId: "m" };

  it("進行中のハドルに誰かいれば「参加する」、いなければ「開始する」", () => {
    expect(toHuddlePreviewView(room("room-1", "雑談", { huddle: null }), preview, self).action).toBe("start");
    expect(toHuddlePreviewView(room("room-1", "雑談", { huddle: roomHuddle([miyuki.id]) }), preview, self).action).toBe("join");
  });

  it("DM はルーム名の代わりに相手の名前", () => {
    const dm = room("room-1", "", { kind: "dm", name: null, dm_peer: { ...miyuki, presence: "offline" } });
    expect(toHuddlePreviewView(dm, preview, self).room).toEqual({ kind: "dm", name: miyuki.display_name });
  });
});

describe("toHuddleScreenView（追記 C）", () => {
  const me = { id: naoki.id, name: naoki.display_name };
  const call = {
    phase: "call" as const,
    roomId: "room-1",
    huddleId: "h-1",
    participantId: "p-1",
    connection: "connected" as const,
    muted: true,
    speaking: [miyuki.id, kei.id],
    mics: [],
  };

  it("自分を先頭にし、自分のミュートは通話の値を使う。ミュートしている人は話している印を出さない", () => {
    const h = roomHuddle([miyuki.id, naoki.id, kei.id]);
    h.participants[2] = { user_id: kei.id, muted: true };
    const view = toHuddleScreenView(room("room-1", "雑談", { huddle: h }), call, { me, names });
    expect(view.participants.map((p) => [p.name, p.muted, p.speaking])).toEqual([
      [naoki.display_name, true, false],
      [miyuki.display_name, false, true],
      [kei.display_name, true, false],
    ]);
    expect(view.muted).toBe(true);
    expect(view.connection).toBe("connected");
  });

  it("状態が届く前（入る途中）も、自分のタイルは出す", () => {
    const view = toHuddleScreenView(room("room-1", "雑談", { huddle: null }), { ...call, huddleId: undefined }, { me, names });
    expect(view.participants.map((p) => p.id)).toEqual([naoki.id]);
  });

  it("別のハドル（終わって新しく始まった）の人は出さない", () => {
    const view = toHuddleScreenView(room("room-1", "雑談", { huddle: roomHuddle([miyuki.id], { id: "h-2" }) }), call, { me, names });
    expect(view.participants.map((p) => p.id)).toEqual([naoki.id]);
  });

  it("「もうすぐ参加する」を押した人（自分を除く）", () => {
    const h = roomHuddle([miyuki.id], { joining_soon: [kei.id, naoki.id] });
    expect(toHuddleScreenView(room("room-1", "雑談", { huddle: h }), call, { me, names }).joiningSoon).toEqual([
      { id: kei.id, name: kei.display_name, avatarUrl: undefined },
    ]);
  });
});

describe("ハドルへのリンク（ADR 0067 決定 1・2）", () => {
  const self = { id: "u-me", name: "あなた" };

  it.each([
    { name: "投稿できる", room: room("r1", "a"), canPost: true, want: "start" },
    { name: "参加していない public", room: room("r1", "a", { is_member: false }), canPost: false, want: "not-member" },
    { name: "アーカイブ", room: room("r1", "a", { archived_at: "2026-09-26T00:00:00Z" }), canPost: false, want: "archived" },
    { name: "それ以外", room: room("r1", "a", { kind: "private" }), canPost: false, want: "ignore" },
  ])("開いたときの振る舞い: $name", ({ room: r, canPost, want }) => {
    expect(huddleLinkAction(r, canPost)).toBe(want);
  });

  it("入れないときのプレビューは、マイクを求めない", () => {
    expect(toBlockedHuddlePreviewView(room("r1", "雑談"), self, "not-member")).toEqual({
      room: { kind: "public", name: "雑談" },
      action: "start",
      self,
      micOn: false,
      mics: [],
      blocked: "not-member",
    });
  });

  const origin = "https://hibari.test";
  const ws = "01J8ZH5K0000000000000000W1";
  const r1 = "01J8ZH5K0000000000000000R1";
  const r2 = "01J8ZH5K0000000000000000R2";
  const r3 = "01J8ZH5K0000000000000000R3";
  const href = (id: string) => `${origin}/w/${ws}/r/${id}?huddle=1`;

  it("本文から、リンクの指すルームを集める（削除したメッセージは除く）", () => {
    expect(
      huddleLinkRoomsIn(
        [
          { body: `${href(r1)} ${href(r2)}`, deleted_at: null },
          { body: href(r1), deleted_at: null },
          { body: href(r3), deleted_at: "2026-09-26T00:00:00Z" },
        ],
        origin,
      ),
    ).toEqual([r1, r2]);
  });

  it("手元のルームは生きた状態から、ないルームは取った結果から作り、まだなら loading", () => {
    const table = huddleLinkCardTable([r1, r2, r3], {
      rooms: {
        [r1]: room(r1, "設計", { workspace_id: "ws-1", huddle: roomHuddle(["u-me", naoki.id]) }),
      },
      fetched: {
        [r2]: {
          room_id: r2,
          status: "ok",
          workspace: { id: "ws-2", name: "別のチーム" },
          room: { id: r2, kind: "public", name: "雑談", dm_peer: null },
          huddle: null,
          can_join: false,
        },
      },
      meId: "u-me",
      huddlesEnabled: true,
      canJoin: () => true,
      currentWorkspaceId: "ws-1",
      names,
    });

    expect(table[r1]).toMatchObject({ state: "ok", room: { name: "設計" }, canJoin: true, huddle: { joined: true } });
    expect(table[r1]).not.toHaveProperty("workspaceName");
    expect(table[r2]).toEqual({
      key: r2,
      state: "ok",
      room: { kind: "public", name: "雑談" },
      workspaceName: "別のチーム",
      huddle: null,
      canJoin: false,
    });
    expect(table[r3]).toEqual({ key: r3, state: "loading" });
  });

  it("ハドルが使えなければ、入れる人にもボタンを出さない。読めないリンクは unavailable", () => {
    const table = huddleLinkCardTable([r1, r2], {
      rooms: { [r1]: room(r1, "設計") },
      fetched: { [r2]: { room_id: r2, status: "unavailable", workspace: null, room: null, huddle: null, can_join: false } },
      huddlesEnabled: false,
      canJoin: () => true,
      names,
    });
    expect(table[r1]).toMatchObject({ canJoin: false });
    expect(table[r2]).toEqual({ key: r2, state: "unavailable" });
  });

  it("メッセージのカードは表から引き、表になければ loading", () => {
    expect(toHuddleLinkCardViews(`${href(r1)} ${href(r2)}`, origin, { [r1]: { key: r1, state: "unavailable" } })).toEqual([
      { key: r1, state: "unavailable" },
      { key: r2, state: "loading" },
    ]);
    expect(toHuddleLinkCardViews("リンクなし", origin, {})).toBeUndefined();
  });
});

describe("ハドルの一覧（ADR 0067 決定 6・7）", () => {
  const now = new Date("2026-09-26T02:32:00Z");
  const all = () => true;

  it("経過時間は、1 分未満なら「数秒」", () => {
    expect(huddleElapsedLabel("2026-09-26T02:31:30Z", now)).toBe("数秒");
    expect(huddleElapsedLabel("2026-09-26T02:20:00Z", now)).toBe("12 分");
  });

  it("進行中のカードは、入れるルームの誰かいるハドルだけを新しい順に出す", () => {
    const rooms = [
      room("r-old", "古い", { huddle: roomHuddle([naoki.id], { started_at: "2026-09-26T02:00:00Z" }) }),
      room("r-new", "新しい", { huddle: roomHuddle(["u-me"], { started_at: "2026-09-26T02:30:00Z" }) }),
      room("r-none", "なし"),
      room("r-closed", "入れない", { huddle: roomHuddle([kei.id]) }),
    ];
    const cards = toHuddleOngoingCards(rooms, { meId: "u-me", names, now, canJoin: (r) => r.id !== "r-closed" });
    expect(cards.map((c) => [c.key, c.joined, c.elapsedLabel])).toEqual([
      ["r-new", true, "2 分"],
      ["r-old", false, "32 分"],
    ]);
  });

  it("サイドバーの行の顔は、入れる進行中のハドルの人を重ねずに並べる", () => {
    const faces = huddleNavFaces(
      [room("a", "a", { huddle: roomHuddle([naoki.id, miyuki.id]) }), room("b", "b", { huddle: roomHuddle([naoki.id]) })],
      { names, canJoin: all },
    );
    expect(faces.map((f) => f.id)).toEqual([naoki.id, miyuki.id]);
  });

  it("最近の行は、会話のハドルのメッセージへのリンクと、自分を先頭にした参加者", () => {
    const view = toHuddleListItemView(
      {
        id: "h-1",
        message_id: "m-h",
        started_by: naoki.id,
        room: { id: "r-1", kind: "dm", name: null, dm_peer: naoki },
        started_at: "2026-09-25T03:00:00Z",
        ended_at: "2026-09-25T03:02:00Z",
        participant_ids: [naoki.id, "u-me"],
        reply_count: 1,
        saved: true,
      },
      { workspaceId: "ws-1", meId: "u-me", names, now, timeZone: "Asia/Tokyo" },
    );
    expect(view).toEqual({
      key: "h-1",
      href: "/w/ws-1/r/r-1?m=m-h",
      threadHref: "/w/ws-1/r/r-1?t=m-h",
      room: { kind: "dm", name: naoki.display_name },
      timeLabel: "23 時間前",
      durationLabel: "2 分",
      replyCount: 1,
      participants: [
        { id: "u-me", name: "あなた", avatarUrl: undefined },
        { id: naoki.id, name: naoki.display_name, avatarUrl: undefined },
      ],
      saved: true,
    });
  });

  it("提案のカードと、場所の絞り込みの候補", () => {
    expect(
      toHuddleSuggestionView({ room: { id: "r-1", kind: "public", name: "設計" }, count: 3, participant_ids: [miyuki.id] }, { names }),
    ).toEqual({ key: "r-1", room: { kind: "public", name: "設計" }, count: 3, participants: [{ id: miyuki.id, name: miyuki.display_name, avatarUrl: undefined }] });
    expect(toHuddlePlaceOptions([room("a", "設計"), room("b", "雑談")], "設").map((o) => o.id)).toEqual(["a"]);
  });
});
