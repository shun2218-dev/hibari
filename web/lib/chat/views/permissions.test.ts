import { describe, expect, it } from "vitest";
import { systemMessageText } from "@/lib/chat/views/message";
import { canPost, messageActions, roomArchiveActions } from "@/lib/chat/views/permissions";
import { toRoomSummaryView } from "@/lib/chat/views/rooms";
import { message, miyuki, naoki, room, systemMessage } from "@/test/chat-data";

describe("アーカイブ（ADR 0059）", () => {
  const archivedAt = "2026-09-23T01:00:00Z";
  const channel = room("r1", "旧案");
  const archived = { ...channel, archived_at: archivedAt };

  it("アーカイブ中は、参加していても投稿できない", () => {
    expect(canPost(channel)).toBe(true);
    expect(canPost(archived)).toBe(false);
    expect(canPost({ ...channel, is_member: false })).toBe(false);
    expect(canPost(room("p1", "秘密", { kind: "private" }))).toBe(true);
  });

  it("アーカイブ中は、自分のメッセージも編集・削除できず、admin も消せない", () => {
    const base = { userId: naoki.id, room: archived, myRole: "owner" as const, senderRole: undefined };
    expect(messageActions(message(1, { sender: naoki }), base)).toEqual({ canEdit: false, canDelete: false });
    expect(messageActions(message(1, { sender: miyuki }), base)).toEqual({ canEdit: false, canDelete: false });
  });

  it.each([
    ["参加している member はアーカイブだけ", channel, "member", { canArchive: true, canDelete: false }],
    ["参加していない member は何もできない", { ...channel, is_member: false }, "member", { canArchive: false, canDelete: false }],
    ["参加していない admin はアーカイブと削除", { ...channel, is_member: false }, "admin", { canArchive: true, canDelete: true }],
    ["DM は対象外", room("d1", "", { kind: "dm" }), "owner", { canArchive: false, canDelete: false }],
    ["既定のルームは対象外", { ...channel, is_default: true }, "owner", { canArchive: false, canDelete: false }],
  ] as const)("%s", (_name, r, role, want) => {
    expect(roomArchiveActions(r, role)).toEqual(want);
  });

  it("サイドバーの 1 行に archived を載せる", () => {
    expect(toRoomSummaryView(archived, new Date(archivedAt)).archived).toBe(true);
    expect(toRoomSummaryView(channel, new Date(archivedAt)).archived).toBe(false);
  });

  it("アーカイブ・復元のログの文言", () => {
    expect(systemMessageText(systemMessage(2, { type: "room_archived" }, { sender: naoki }))).toBe(
      "佐藤 直樹 がチャンネルをアーカイブしました",
    );
    expect(systemMessageText(systemMessage(3, { type: "room_unarchived" }, { sender: naoki }))).toBe(
      "佐藤 直樹 がチャンネルを復元しました",
    );
  });
});

describe("messageActions", () => {
  const channel = room("r1", "雑談");
  const base = { userId: naoki.id, room: channel, myRole: "member" as const, senderRole: undefined };

  it("lets me edit and delete my own messages while I can post", () => {
    expect(messageActions(message(1, { sender: naoki }), base)).toEqual({ canEdit: true, canDelete: true });
    expect(messageActions(message(1, { sender: naoki }), { ...base, room: { ...channel, is_member: false } })).toEqual({
      canEdit: false,
      canDelete: false,
    });
  });

  it("lets admins and above delete messages of lower roles, but never edit them", () => {
    const theirs = message(1, { sender: miyuki });
    expect(messageActions(theirs, base)).toEqual({ canEdit: false, canDelete: false });
    expect(messageActions(theirs, { ...base, myRole: "admin" })).toEqual({ canEdit: false, canDelete: true });
    expect(messageActions(theirs, { ...base, myRole: "admin", senderRole: "admin" }).canDelete).toBe(false);
    expect(messageActions(theirs, { ...base, myRole: "owner", senderRole: "admin" }).canDelete).toBe(true);
    // 相手のロールが分からなければ出し、サーバーに判断させる
    expect(messageActions(theirs, { ...base, myRole: "admin", senderRole: undefined }).canDelete).toBe(true);
  });

  it("does not moderate DMs or deleted messages", () => {
    const dm = room("d1", "", { kind: "dm" });
    expect(messageActions(message(1, { sender: miyuki }), { ...base, room: dm, myRole: "owner" }).canDelete).toBe(false);
    expect(messageActions(message(1, { sender: naoki, deleted_at: "2026-09-13T01:00:00Z" }), base)).toEqual({
      canEdit: false,
      canDelete: false,
    });
  });
});
