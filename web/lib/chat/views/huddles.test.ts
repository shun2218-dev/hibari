import { describe, expect, it } from "vitest";

import type { MessageHuddle, RoomHuddle } from "@/lib/api/types.gen";
import { kei, miyuki, naoki, room } from "@/test/chat-data";

import {
  huddleDurationLabel,
  huddleHeaderState,
  huddleParticipantNames,
  roomHuddleBadge,
  toHuddleMessageView,
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
