import { describe, expect, it } from "vitest";
import { mentionAllRecipients, toDmCandidates, toMemberNames, toMentionCandidates, toRoomMemberRows, toRoomMemberView } from "@/lib/chat/views/members";
import { kei, member, miyuki, naoki, roomMember } from "@/test/chat-data";

describe("toRoomMemberView", () => {
  it("labels the workspace role", () => {
    expect(
      toRoomMemberView(roomMember(naoki, { role: "owner", presence: "active" }), { [naoki.id]: "https://storage.test/n" }),
    ).toEqual({
      id: naoki.id,
      name: "佐藤 直樹",
      avatarUrl: "https://storage.test/n",
      presence: "online",
      roleLabel: "オーナー",
    });
  });
});

describe("toDmCandidates", () => {
  const members = [
    member(naoki, { role: "owner", presence: "active" }),
    member(miyuki),
    member(kei, { presence: "active" }),
  ];

  it("leaves out the viewer and anyone already in the room", () => {
    expect(toDmCandidates(members, { userId: naoki.id, exclude: [kei.id] })).toEqual([
      { id: miyuki.id, name: miyuki.display_name, handle: miyuki.handle, presence: "offline" },
    ]);
  });

  it("filters by display name or handle", () => {
    expect(toDmCandidates(members, { userId: naoki.id, search: "みゆき" }).map((c) => c.id)).toEqual([miyuki.id]);
    expect(toDmCandidates(members, { userId: naoki.id, search: "KEI" }).map((c) => c.id)).toEqual([kei.id]);
    expect(toDmCandidates(members, { userId: naoki.id, search: "いない人" })).toEqual([]);
  });
});

describe("toRoomMemberRows", () => {
  it("lets admins remove members below them, but never themselves", () => {
    const rows = toRoomMemberRows([roomMember(naoki, { role: "admin" }), roomMember(miyuki), roomMember(kei, { role: "admin" })], {
      userId: naoki.id,
      myRole: "admin",
    });

    expect(rows.map((r) => [r.id, r.isSelf, r.canRemove])).toEqual([
      [naoki.id, true, false],
      [miyuki.id, false, true],
      // 同じロールの人は外せない（authz.CanManage）
      [kei.id, false, false],
    ]);
  });

  it("offers nothing to a member", () => {
    const rows = toRoomMemberRows([roomMember(miyuki)], { userId: naoki.id, myRole: "member" });

    expect(rows[0].canRemove).toBe(false);
  });
});

describe("toMentionCandidates", () => {
  const members = [roomMember(naoki), roomMember(miyuki)];

  it("メンバーを一覧の順に並べ、最後に channel と here を足す", () => {
    const candidates = toMentionCandidates(members, { kind: "public" });
    expect(candidates.map((c) => (c.kind === "user" ? c.handle : c.kind))).toEqual([
      "naoki",
      "miyuki",
      "channel",
      "here",
    ]);
    expect(candidates[0]).toMatchObject({ id: naoki.id, name: "佐藤 直樹" });
  });

  it("DM には全員宛てを出さない（相手 1 人にしか飛ばず、確認の意味がない）", () => {
    expect(toMentionCandidates(members, { kind: "dm" }).map((c) => c.kind)).toEqual(["user", "user"]);
  });

  it("アバターがあれば添える", () => {
    const [first] = toMentionCandidates(members, { kind: "private", avatarUrls: { [naoki.id]: "https://s.test/n" } });
    expect(first).toMatchObject({ avatarUrl: "https://s.test/n" });
  });

  it("メンバーが取れていなければ全員宛てだけ", () => {
    expect(toMentionCandidates(undefined, { kind: "public" }).map((c) => c.kind)).toEqual(["channel", "here"]);
  });
});

describe("toMemberNames", () => {
  it("ID から表示名を引ける表にする", () => {
    expect(toMemberNames([roomMember(naoki), roomMember(kei)])).toEqual({
      [naoki.id]: "佐藤 直樹",
      [kei.id]: "森田 圭",
    });
  });

  it("取れていなければ空", () => {
    expect(toMemberNames(undefined)).toEqual({});
  });
});

describe("mentionAllRecipients", () => {
  const members = [roomMember(naoki, { presence: "active" }), roomMember(miyuki), roomMember(kei, { presence: "active" })];

  it("channel はメンバー全員から自分を引いた数", () => {
    expect(mentionAllRecipients(members, "channel", naoki.id)).toBe(2);
  });

  it("here はそのうちオンラインの人だけ", () => {
    expect(mentionAllRecipients(members, "here", naoki.id)).toBe(1);
    expect(mentionAllRecipients(members, "here", miyuki.id)).toBe(2);
  });

  it("メンバーが取れていなければ 0", () => {
    expect(mentionAllRecipients(undefined, "channel", naoki.id)).toBe(0);
  });
});
