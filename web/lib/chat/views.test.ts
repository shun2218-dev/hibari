import { describe, expect, it } from "vitest";

import type { TimelineItem } from "@/components/chat/types";
import type { MessageAttachment, MessageLink } from "@/lib/api/types.gen";
import { kei, member, message, miyuki, naoki, room, roomMember, systemMessage } from "@/test/chat-data";

import {
  alsoInChannelDoneLabel,
  alsoInChannelLabel,
  mentionAllRecipients,
  messageActions,
  previewImageIds,
  toAttachmentDraftView,
  systemMessageText,
  toDmCandidates,
  toMemberNames,
  toMentionCandidates,
  toRoomMemberRows,
  toRoomMemberView,
  toRoomSummaryView,
  toThreadListItemView,
  toThreadTimelineItems,
  toTimelineItems,
  permalinksIn,
} from "./views";

const tz = "Asia/Tokyo";

/** 区切りは種類、メッセージは「本文（grouped なら +）」にして並びを比べる。 */
function outline(items: TimelineItem[]): string[] {
  return items.map((item) => {
    switch (item.type) {
      case "date":
        return `[${item.label}]`;
      case "unread":
        return "[unread]";
      case "system":
        return `[system: ${item.text}]`;
      case "thread-divider":
        return `[${item.replyCount} replies]`;
      case "message":
        return item.message.grouped ? `+${item.message.body}` : item.message.body;
    }
  });
}

describe("toRoomSummaryView", () => {
  const now = new Date("2026-09-13T02:00:00Z");

  it("prefixes the sender for channels", () => {
    const view = toRoomSummaryView(
      room("r1", "雑談", {
        last_message_at: "2026-09-13T01:22:00Z",
        unread_count: 3,
        last_message: { id: "m1", sender: miyuki, kind: "user", body: "喫茶店ができたらしい", created_at: "2026-09-13T01:22:00Z", deleted: false },
      }),
      now,
      { timeZone: tz },
    );

    expect(view).toMatchObject({ name: "雑談", lastMessage: "高橋 みゆき: 喫茶店ができたらしい", timeLabel: "10:22", unreadCount: 3 });
  });

  it("names a DM after the peer and omits the sender", () => {
    const view = toRoomSummaryView(
      room("r2", "", {
        kind: "dm",
        name: null,
        dm_peer: { ...naoki, online: true },
        last_message_at: "2026-09-12T01:00:00Z",
        last_message: { id: "m2", sender: naoki, kind: "user", body: "あとで見ます", created_at: "2026-09-12T01:00:00Z", deleted: false },
      }),
      now,
      { timeZone: tz, avatarUrls: { [naoki.id]: "https://storage.test/naoki.png" } },
    );

    expect(view).toMatchObject({
      name: "佐藤 直樹",
      peer: { id: naoki.id, online: true, avatarUrl: "https://storage.test/naoki.png" },
      lastMessage: "あとで見ます",
      timeLabel: "昨日",
    });
  });

  it("does not leak the body of a deleted last message", () => {
    const view = toRoomSummaryView(
      room("r3", "雑談", {
        last_message_at: "2026-09-13T01:00:00Z",
        last_message: { id: "m3", sender: miyuki, kind: "user", body: "", created_at: "2026-09-13T01:00:00Z", deleted: true },
      }),
      now,
      { timeZone: tz },
    );

    expect(view.lastMessage).toBe("高橋 みゆき: このメッセージは削除されました");
  });

  it("shows a placeholder for a message with only attachments", () => {
    const view = toRoomSummaryView(
      room("r5", "雑談", {
        last_message_at: "2026-09-13T01:00:00Z",
        last_message: { id: "m5", sender: miyuki, kind: "user", body: "", created_at: "2026-09-13T01:00:00Z", deleted: false },
      }),
      now,
      { timeZone: tz },
    );

    expect(view.lastMessage).toBe("高橋 みゆき: 添付ファイル");
  });

  it("has no preview for a room without messages", () => {
    expect(toRoomSummaryView(room("r4", "新しい"), now, { timeZone: tz })).toMatchObject({ lastMessage: undefined, timeLabel: undefined });
  });
});

const png: MessageAttachment = {
  id: "a1",
  file_name: "mock.png",
  content_type: "image/png",
  size_bytes: 10,
  width: 260,
  height: 160,
};
const pdf: MessageAttachment = {
  id: "a2",
  file_name: "scale.pdf",
  content_type: "application/pdf",
  size_bytes: 253_952,
  width: null,
  height: null,
};

describe("toTimelineItems", () => {
  it("inserts a date divider whenever the local day changes", () => {
    const items = toTimelineItems(
      [
        message(1, { body: "a", created_at: "2026-09-12T14:00:00Z" }), // 東京で 9/12 23:00
        message(2, { body: "b", created_at: "2026-09-12T15:30:00Z", sender: naoki }), // 9/13 00:30
      ],
      { unreadAfterSeq: null, timeZone: tz },
    );

    expect(outline(items)).toEqual(["[2026年9月12日]", "a", "[2026年9月13日]", "b"]);
  });

  it("groups consecutive messages from the same sender within five minutes", () => {
    const items = toTimelineItems(
      [
        message(1, { body: "a", created_at: "2026-09-13T01:00:00Z" }),
        message(2, { body: "b", created_at: "2026-09-13T01:04:59Z" }),
        message(3, { body: "c", created_at: "2026-09-13T01:10:00Z" }),
        message(4, { body: "d", created_at: "2026-09-13T01:10:30Z", sender: naoki }),
        message(5, { body: "e", created_at: "2026-09-13T01:10:40Z", sender: naoki }),
      ],
      { unreadAfterSeq: null, timeZone: tz },
    );

    expect(outline(items)).toEqual(["[2026年9月13日]", "a", "+b", "c", "d", "+e"]);
  });

  it("leaves thread replies out of the channel timeline (ADR 0036)", () => {
    const items = toTimelineItems(
      [
        message(1, { body: "親" }),
        message(2, { body: "返信", thread_root_id: "m-1", thread_seq: 1 }),
        message(3, { body: "チャンネル", sender: naoki }),
      ],
      { unreadAfterSeq: 1, timeZone: tz },
    );

    // 返信（seq 2）は出さず、未読の区切りは次のチャンネルの発言の前に出す
    expect(outline(items)).toEqual(["[2026年9月13日]", "親", "[unread]", "チャンネル"]);
  });

  it("puts the unread divider before the first message after the last read seq and breaks the group there", () => {
    const items = toTimelineItems([message(1, { body: "a" }), message(2, { body: "b" }), message(3, { body: "c" })], {
      unreadAfterSeq: 1,
      timeZone: tz,
    });

    expect(outline(items)).toEqual(["[2026年9月13日]", "a", "[unread]", "b", "+c"]);
  });

  it("has no unread divider when everything is read", () => {
    const items = toTimelineItems([message(1), message(2)], { unreadAfterSeq: 2, timeZone: tz });

    expect(items.some((item) => item.type === "unread")).toBe(false);
  });

  it("fills in the avatar and image urls that have been loaded", () => {
    const items = toTimelineItems(
      [
        message(1, { attachments: [png, { ...png, id: "a3" }, { ...png, id: "a4", content_type: "image/svg+xml" }] }),
        message(2, { sender: naoki }),
      ],
      {
        unreadAfterSeq: null,
        avatarUrls: { [miyuki.id]: "https://storage.test/miyuki.png", [naoki.id]: null },
        attachmentUrls: { a1: "https://storage.test/a1", a3: null },
        timeZone: tz,
      },
    );
    const [first, second] = items.flatMap((item) => (item.type === "message" ? [item.message] : []));

    expect(first.sender.avatarUrl).toBe("https://storage.test/miyuki.png");
    expect(second.sender.avatarUrl).toBeUndefined();
    // SVG はブラウザで開かせない（ADR 0013）ので、ファイルとして出す
    expect(first.attachments).toEqual([
      expect.objectContaining({ kind: "image", id: "a1", url: "https://storage.test/a1" }),
      expect.objectContaining({ kind: "image", id: "a3", url: undefined }),
      expect.objectContaining({ kind: "file", id: "a4" }),
    ]);
  });

  it("hides deleted messages, except a thread root that still has replies (ADR 0038)", () => {
    const deleted = { deleted_at: "2026-09-13T01:05:00Z", body: "" };
    const items = toTimelineItems(
      [
        message(1, { ...deleted }),
        message(2, { ...deleted, thread: { reply_count: 1, last_thread_seq: 2, last_reply_at: "2026-09-13T01:10:00Z" } }),
        message(3, { ...deleted, thread: { reply_count: 0, last_thread_seq: 1, last_reply_at: "2026-09-13T01:10:00Z" } }),
        message(4, { body: "残る" }),
      ],
      { unreadAfterSeq: null, timeZone: tz },
    );
    const messages = items.flatMap((item) => (item.type === "message" ? [item.message] : []));

    expect(messages.map((m) => [m.key, m.deleted])).toEqual([["m-2", true], ["m-4", false]]);
  });

  it("puts the unread divider before the first visible message when the first unread one was deleted", () => {
    const items = toTimelineItems(
      [message(1, { body: "a" }), message(2, { deleted_at: "2026-09-13T01:05:00Z", body: "" }), message(3, { body: "c" })],
      { unreadAfterSeq: 1, timeZone: tz },
    );

    expect(outline(items)).toEqual(["[2026年9月13日]", "a", "[unread]", "c"]);
  });

  it("maps edited messages and attachments", () => {
    const items = toTimelineItems(
      [
        message(2, {
          sender: naoki,
          edited_at: "2026-09-13T01:06:00Z",
          attachments: [
            { id: "a1", file_name: "mock.png", content_type: "image/png", size_bytes: 10, width: 260, height: 160 },
            { id: "a2", file_name: "scale.pdf", content_type: "application/pdf", size_bytes: 253_952, width: null, height: null },
          ],
        }),
      ],
      { unreadAfterSeq: null, timeZone: tz },
    );
    const [edited] = items.flatMap((item) => (item.type === "message" ? [item.message] : []));

    expect(edited).toMatchObject({
      edited: true,
      attachments: [
        { kind: "image", id: "a1", fileName: "mock.png", width: 260, height: 160 },
        { kind: "file", id: "a2", fileName: "scale.pdf", sizeLabel: "248 KB" },
      ],
    });
  });

  it("appends my unconfirmed messages after the confirmed ones, grouped with my last message", () => {
    const items = toTimelineItems([message(1, { body: "a", sender: naoki }), message(2, { body: "b" })], {
      unreadAfterSeq: 1,
      me: naoki,
      outgoing: [
        {
          clientMsgId: "c-x",
          body: "送信中",
          threadRootId: null,
          alsoInChannel: false,
          attachments: [pdf],
          status: "pending",
          createdAt: "2026-09-13T01:01:00Z",
        },
        {
          clientMsgId: "c-y",
          body: "失敗",
          threadRootId: null,
          alsoInChannel: false,
          attachments: [],
          status: "failed",
          createdAt: "2026-09-13T01:02:00Z",
        },
      ],
      timeZone: tz,
    });
    const messages = items.flatMap((item) => (item.type === "message" ? [item.message] : []));

    expect(outline(items)).toEqual(["[2026年9月13日]", "a", "[unread]", "b", "送信中", "+失敗"]);
    expect(messages[2]).toMatchObject({
      key: "c-x",
      status: "pending",
      sender: { id: naoki.id },
      timeLabel: "10:01",
      attachments: [{ kind: "file", id: "a2", fileName: "scale.pdf" }],
    });
    expect(messages[3]).toMatchObject({ key: "c-y", status: "failed" });
  });
});

describe("previewImageIds", () => {
  it("lists the images of messages that are not deleted", () => {
    expect(
      previewImageIds([
        message(1, { attachments: [png, pdf] }),
        message(2, { attachments: [{ ...png, id: "a5" }], deleted_at: "2026-09-13T01:00:00Z" }),
        message(3, { attachments: [{ ...png, id: "a6", content_type: "image/jpeg" }] }),
      ]),
    ).toEqual(["a1", "a6"]);
  });
});

describe("toAttachmentDraftView", () => {
  const file = new File(["x".repeat(2048)], "サイドバー改訂.fig");
  const base = { key: "draft-1", file, fileName: file.name, progress: 0, attachment: null };

  it("maps each upload status", () => {
    expect(toAttachmentDraftView({ ...base, status: "uploading", progress: 62 })).toEqual({
      id: "draft-1",
      fileName: "サイドバー改訂.fig",
      status: "uploading",
      progress: 62,
    });
    expect(toAttachmentDraftView({ ...base, status: "failed" })).toEqual({
      id: "draft-1",
      fileName: "サイドバー改訂.fig",
      status: "failed",
    });
    expect(toAttachmentDraftView({ ...base, status: "uploaded", progress: 100, attachment: pdf })).toEqual({
      id: "draft-1",
      fileName: "サイドバー改訂.fig",
      status: "uploaded",
      sizeLabel: "2 KB",
    });
  });
});

describe("toRoomMemberView", () => {
  it("labels the workspace role", () => {
    expect(
      toRoomMemberView(roomMember(naoki, { role: "owner", online: true }), { [naoki.id]: "https://storage.test/n" }),
    ).toEqual({
      id: naoki.id,
      name: "佐藤 直樹",
      avatarUrl: "https://storage.test/n",
      online: true,
      roleLabel: "オーナー",
    });
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

describe("toDmCandidates", () => {
  const members = [
    member(naoki, { role: "owner", online: true }),
    member(miyuki),
    member(kei, { online: true }),
  ];

  it("leaves out the viewer and anyone already in the room", () => {
    expect(toDmCandidates(members, { userId: naoki.id, exclude: [kei.id] })).toEqual([
      { id: miyuki.id, name: miyuki.display_name, handle: miyuki.handle, online: false },
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

describe("システムメッセージ（ADR 0033）", () => {
  it("writes each kind of log with the subject first", () => {
    const by = (system: Parameters<typeof systemMessage>[1]) =>
      systemMessageText(systemMessage(2, system, { sender: miyuki }));

    expect(by({ type: "room_created" })).toBe("高橋 みゆき がこのチャンネルを作成しました");
    expect(by({ type: "member_joined" })).toBe("高橋 みゆき がチャンネルに参加しました");
    expect(by({ type: "member_left" })).toBe("高橋 みゆき がチャンネルを退出しました");
    expect(by({ type: "member_removed" })).toBe("高橋 みゆき がチャンネルから外されました");
    expect(by({ type: "room_renamed", old_name: "雑談", new_name: "雑談 改" })).toBe(
      "高橋 みゆき がチャンネル名を 雑談 から 雑談 改 に変更しました",
    );
  });

  it("puts the log between messages without grouping them", () => {
    const items = toTimelineItems(
      [
        message(1, { sender: miyuki, body: "おはよう" }),
        systemMessage(2, { type: "member_joined" }, { sender: naoki }),
        message(3, { sender: miyuki, body: "今日もよろしく" }),
      ],
      { unreadAfterSeq: null, timeZone: tz },
    );

    expect(outline(items)).toEqual([
      "[2026年9月13日]",
      "おはよう",
      "[system: 佐藤 直樹 がチャンネルに参加しました]",
      // ログを挟んだので、同じ人の発言でも続けて表示（+）にしない
      "今日もよろしく",
    ]);
  });

  it("does not put the unread divider before a log", () => {
    const items = toTimelineItems(
      [
        message(1, { sender: miyuki, body: "既読の発言" }),
        systemMessage(2, { type: "member_joined" }, { sender: naoki }),
        message(3, { sender: miyuki, body: "未読の発言" }),
      ],
      { unreadAfterSeq: 1, timeZone: tz },
    );

    // 区切りはログを飛ばして、未読の「人の発言」の前に出す
    expect(outline(items)).toEqual([
      "[2026年9月13日]",
      "既読の発言",
      "[system: 佐藤 直樹 がチャンネルに参加しました]",
      "[unread]",
      "未読の発言",
    ]);
  });

  it("does not show the divider when only logs are new", () => {
    const items = toTimelineItems(
      [message(1, { sender: miyuki, body: "既読の発言" }), systemMessage(2, { type: "member_joined" })],
      { unreadAfterSeq: 1, timeZone: tz },
    );

    expect(outline(items)).not.toContain("[unread]");
  });

  it("shows the log itself in the sidebar, without the sender prefix", () => {
    const view = toRoomSummaryView(
      room("r1", "雑談", {
        last_message_at: "2026-09-13T01:22:00Z",
        last_message: {
          id: "m2",
          sender: naoki,
          kind: "system",
          system: { type: "member_joined" },
          body: "",
          created_at: "2026-09-13T01:22:00Z",
          deleted: false,
        },
      }),
      new Date("2026-09-13T02:00:00Z"),
      { timeZone: tz },
    );

    expect(view.lastMessage).toBe("佐藤 直樹 がチャンネルに参加しました");
  });
});

describe("threads (ADR 0036)", () => {
  const thread = { reply_count: 2, last_thread_seq: 3, last_reply_at: "2026-09-13T02:30:00Z" };

  it("shows the reply count under a root only while it has replies", () => {
    const items = toTimelineItems(
      [message(1, { thread }), message(2, { thread: { ...thread, reply_count: 0 } }), message(3)],
      { unreadAfterSeq: null, timeZone: tz, now: new Date("2026-09-13T03:00:00Z") },
    );
    const [withReplies, allDeleted, plain] = items.flatMap((item) => (item.type === "message" ? [item.message] : []));

    expect(withReplies!.thread).toEqual({ replyCount: 2, lastReplyLabel: "11:30" });
    expect(allDeleted!.thread).toBeUndefined();
    expect(plain!.thread).toBeUndefined();
  });

  it("keeps my unsent thread replies out of the channel", () => {
    const items = toTimelineItems([message(1)], {
      unreadAfterSeq: null,
      me: naoki,
      outgoing: [{ clientMsgId: "c-t", body: "スレッドへ", threadRootId: "m-1", alsoInChannel: false, attachments: [], status: "pending", createdAt: "2026-09-13T01:01:00Z" }],
      timeZone: tz,
    });

    expect(outline(items)).toEqual(["[2026年9月13日]", "本文 1"]);
  });

  it("lays out the thread panel as root, divider, replies and my unsent replies, without dates or the root's summary", () => {
    const root = message(1, { thread, body: "親" });
    const replies = [
      message(2, { body: "返信 1", thread_root_id: "m-1", thread_seq: 1, created_at: "2026-09-14T01:00:00Z" }),
      message(4, { body: "返信 2", thread_root_id: "m-1", thread_seq: 2, created_at: "2026-09-14T01:01:00Z" }),
    ];
    const items = toThreadTimelineItems(
      { root, replies },
      {
        me: naoki,
        outgoing: [
          { clientMsgId: "c-t", body: "送信中の返信", threadRootId: "m-1", alsoInChannel: false, attachments: [], status: "pending", createdAt: "2026-09-14T01:02:00Z" },
          { clientMsgId: "c-c", body: "チャンネルへ", threadRootId: null, alsoInChannel: false, attachments: [], status: "pending", createdAt: "2026-09-14T01:02:00Z" },
        ],
        timeZone: tz,
      },
    );

    expect(outline(items)).toEqual(["親", "[2 replies]", "返信 1", "+返信 2", "送信中の返信"]);
    expect(items[0]!.type === "message" && items[0].message.thread).toBeUndefined();
    expect(toThreadTimelineItems({ root: null, replies }, { timeZone: tz })).toEqual([]);
  });

  it("names the channel checkbox and the note by the room kind (ADR 0039)", () => {
    expect(alsoInChannelLabel("public")).toBe("チャンネルにも投稿する");
    expect(alsoInChannelLabel("private")).toBe("チャンネルにも投稿する");
    expect(alsoInChannelLabel("dm")).toBe("DM にも投稿する");
    expect(alsoInChannelDoneLabel("public")).toBe("チャンネルにも投稿しました");
    expect(alsoInChannelDoneLabel("dm")).toBe("DM にも投稿しました");
  });

  it("maps a followed thread to a list row, naming a dm by the peer", () => {
    const view = toThreadListItemView(
      {
        room: { id: "d1", kind: "dm", name: null, dm_peer: naoki },
        root: { id: "m-1", sender: miyuki, kind: "user", body: "親", created_at: "2026-09-12T01:00:00Z", deleted: false },
        root_seq: 1,
        reply_count: 3,
        last_reply_at: "2026-09-13T02:30:00Z",
        last_thread_seq: 3,
        last_read_thread_seq: 1,
        unread_count: 2,
      },
      new Date("2026-09-13T03:00:00Z"),
      { timeZone: tz },
    );

    expect(view).toMatchObject({
      key: "m-1",
      room: { kind: "dm", name: "佐藤 直樹" },
      root: { sender: { id: miyuki.id, name: "高橋 みゆき" }, timeLabel: "昨日", body: "親", deleted: false },
      replyCount: 3,
      lastReplyLabel: "11:30",
      unreadCount: 2,
    });
  });
});


// 本文に貼られたパーマリンクのカード（ADR 0040）

const ORIGIN = "https://hibari.example";
const WS = "01J9ZQZQZQZQZQZQZQZQZQZQZA";
const OTHER_WS = "01J9ZQZQZQZQZQZQZQZQZQZQZF";
const LINK_ROOM = "01J9ZQZQZQZQZQZQZQZQZQZQZB";
const LINK_MSG = "01J9ZQZQZQZQZQZQZQZQZQZQZC";
const PERMALINK = `${ORIGIN}/w/${WS}/r/${LINK_ROOM}?m=${LINK_MSG}`;
const LINK_KEY = `${LINK_ROOM}/${LINK_MSG}`;

function linkResult(overrides: Partial<MessageLink> = {}): MessageLink {
  return {
    room_id: LINK_ROOM,
    message_id: LINK_MSG,
    status: "ok",
    workspace: { id: WS, name: "山と印刷" },
    room: { id: LINK_ROOM, kind: "public", name: "雑談", dm_peer: null },
    message: {
      id: LINK_MSG,
      seq: 7,
      sender: naoki,
      body: "元の発言",
      thread_root_id: null,
      attachment_count: 0,
      created_at: "2026-09-13T01:30:00Z",
      edited_at: null,
      deleted_at: null,
    },
    ...overrides,
  };
}

/** linkResult().message は必ず入る（ok の結果を作るヘルパー）ので、絞り込みを 1 箇所にまとめる。 */
function linkMessage(): NonNullable<MessageLink["message"]> {
  return linkResult().message!;
}

function cardsOf(
  messages: Parameters<typeof toTimelineItems>[0],
  linkCards: Record<string, MessageLink>,
  extra: Partial<Parameters<typeof toTimelineItems>[1]> = {},
) {
  const items = toTimelineItems(messages, {
    unreadAfterSeq: null,
    origin: ORIGIN,
    linkCards,
    timeZone: tz,
    ...extra,
  });
  const first = items.find((i): i is Extract<TimelineItem, { type: "message" }> => i.type === "message");
  return first?.message.linkCards;
}

describe("permalinksIn", () => {
  it("画面に出す本文からリンクを集め、重複をまとめる", () => {
    const messages = [message(1, { body: `見て ${PERMALINK}` }), message(2, { body: `これも ${PERMALINK}` })];
    expect(permalinksIn(messages, ORIGIN)).toEqual([{ workspaceId: WS, roomId: LINK_ROOM, messageId: LINK_MSG }]);
  });

  it("削除したメッセージの本文は見ない（本文が空になっている）", () => {
    const messages = [message(1, { body: "", deleted_at: "2026-09-13T02:00:00Z" })];
    expect(permalinksIn(messages, ORIGIN)).toEqual([]);
  });
});

describe("toTimelineItems のリンクのカード", () => {
  it("まだ取れていないリンクは loading にする", () => {
    expect(cardsOf([message(1, { body: PERMALINK })], {})).toEqual([{ key: LINK_KEY, state: "loading" }]);
  });

  it("リンクのない本文にはカードを持たせない", () => {
    expect(cardsOf([message(1, { body: "ただの本文" })], {})).toBeUndefined();
  });

  it("オリジンが分からなければカードを出さない（サーバー側の描画）", () => {
    const items = toTimelineItems([message(1, { body: PERMALINK })], { unreadAfterSeq: null, timeZone: tz });
    const first = items.find((i): i is Extract<TimelineItem, { type: "message" }> => i.type === "message");
    expect(first?.message.linkCards).toBeUndefined();
  });

  it("読めるリンクは、ルーム・送信者・時刻を整形して渡す", () => {
    const [card] = cardsOf([message(1, { body: PERMALINK })], { [LINK_KEY]: linkResult() }) ?? [];
    expect(card).toMatchObject({
      key: LINK_KEY,
      state: "ok",
      room: { kind: "public", name: "雑談" },
      sender: { id: naoki.id, name: naoki.display_name },
      timeLabel: "10:30",
      body: "元の発言",
      clamped: false,
      attachmentCount: 0,
      inThread: false,
    });
  });

  it("読めないリンクは unavailable にする", () => {
    const result = linkResult({ status: "unavailable", workspace: null, room: null, message: null });
    expect(cardsOf([message(1, { body: PERMALINK })], { [LINK_KEY]: result })).toEqual([
      { key: LINK_KEY, state: "unavailable" },
    ]);
  });

  it("削除済みのリンクも、読めないリンクと同じ見え方にする（ADR 0038 / 0040。オーナーの確認: 2026-09-19）", () => {
    const result = linkResult({
      message: { ...linkMessage(), body: "", deleted_at: "2026-09-13T02:00:00Z" },
    });
    expect(cardsOf([message(1, { body: PERMALINK })], { [LINK_KEY]: result })).toEqual([
      { key: LINK_KEY, state: "unavailable" },
    ]);
  });

  it("今いるワークスペースと同じならワークスペース名を出さない", () => {
    const [card] = cardsOf([message(1, { body: PERMALINK })], { [LINK_KEY]: linkResult() }, { currentWorkspaceId: WS }) ?? [];
    expect(card).not.toHaveProperty("workspaceName");
  });

  it("別のワークスペースならワークスペース名を添える", () => {
    const result = linkResult({ workspace: { id: OTHER_WS, name: "別の会社" } });
    const [card] = cardsOf([message(1, { body: PERMALINK })], { [LINK_KEY]: result }, { currentWorkspaceId: WS }) ?? [];
    expect(card).toMatchObject({ workspaceName: "別の会社" });
  });

  it("dm はルーム名の代わりに相手の名前を出す", () => {
    const result = linkResult({ room: { id: LINK_ROOM, kind: "dm", name: "", dm_peer: miyuki } });
    const [card] = cardsOf([message(1, { body: PERMALINK })], { [LINK_KEY]: result }) ?? [];
    expect(card).toMatchObject({ room: { kind: "dm", name: miyuki.display_name } });
  });

  it("長い本文は畳んだ本文も一緒に渡す", () => {
    const long = Array.from({ length: 10 }, (_, i) => `${i + 1} 行目`).join("\n");
    const result = linkResult({ message: { ...linkMessage(), body: long } });
    const [card] = cardsOf([message(1, { body: PERMALINK })], { [LINK_KEY]: result }) ?? [];
    expect(card).toMatchObject({ clamped: true, body: long });
    expect((card as { clampedBody: string }).clampedBody.endsWith("…")).toBe(true);
  });

  it("スレッドの返信なら、カードの遷移先に親の ID を入れる", () => {
    const root = "01J9ZQZQZQZQZQZQZQZQZQZQZD";
    const result = linkResult({ message: { ...linkMessage(), thread_root_id: root } });
    const [card] = cardsOf([message(1, { body: PERMALINK })], { [LINK_KEY]: result }) ?? [];
    // 遷移先はアプリの中のパス（オリジンから始まる URL だとページごと読み込み直しになる）
    expect(card).toMatchObject({ inThread: true, href: `/w/${WS}/r/${LINK_ROOM}?m=${LINK_MSG}&t=${root}` });
  });

  it("添付の件数を渡す", () => {
    const result = linkResult({ message: { ...linkMessage(), attachment_count: 3 } });
    const [card] = cardsOf([message(1, { body: PERMALINK })], { [LINK_KEY]: result }) ?? [];
    expect(card).toMatchObject({ attachmentCount: 3 });
  });
});

describe("チャンネルにも投稿する（ADR 0039）", () => {
  const root = message(1, {
    body: "親",
    sender: naoki,
    thread: { reply_count: 2, last_thread_seq: 2, last_reply_at: "2026-09-13T01:02:00Z" },
  });
  const broadcast = message(2, {
    body: "流した返信",
    sender: naoki,
    thread_root_id: "m-1",
    thread_seq: 1,
    also_in_channel: true,
    created_at: "2026-09-13T01:01:00Z",
  });
  const plainReply = message(3, {
    body: "普通の返信",
    sender: naoki,
    thread_root_id: "m-1",
    thread_seq: 2,
    created_at: "2026-09-13T01:02:00Z",
  });

  it("puts a reply sent to the channel in the channel timeline, at its room seq", () => {
    const items = toTimelineItems([root, broadcast, plainReply, message(4, { body: "あと", sender: miyuki })], {
      unreadAfterSeq: null,
      timeZone: tz,
    });

    // 流した返信だけがチャンネルに並ぶ。普通の返信は手元にあっても出さない（ADR 0036）
    expect(outline(items)).toEqual(["[2026年9月13日]", "親", "流した返信", "あと"]);
  });

  it("labels the channel row so it opens the thread, and does not group it with the message above", () => {
    const items = toTimelineItems([root, broadcast, message(4, { body: "続き", sender: naoki })], {
      unreadAfterSeq: null,
      timeZone: tz,
    });
    const [rootView, broadcastView, next] = items.flatMap((item) => (item.type === "message" ? [item.message] : []));

    expect(broadcastView!.broadcast).toEqual({ in: "channel" });
    // 同じ人が続けて送っていても、スレッドから来た行だと分かるようにアバターと名前を省かない（docs/ui/README.md）
    expect(broadcastView!.grouped).toBe(false);
    expect(next!.grouped).toBe(false);
    expect(rootView!.broadcast).toBeUndefined();
  });

  it("counts a reply sent to the channel as unread in the channel", () => {
    const items = toTimelineItems([root, broadcast], { unreadAfterSeq: 1, timeZone: tz });

    expect(outline(items)).toEqual(["[2026年9月13日]", "親", "[unread]", "流した返信"]);
  });

  it("adds the note to the thread panel row instead, and only when the wording is given", () => {
    const withLabel = toThreadTimelineItems(
      { root, replies: [broadcast, plainReply] },
      { timeZone: tz, broadcastDoneLabel: alsoInChannelDoneLabel("public") },
    );
    const [, sentToChannel, plain] = withLabel.flatMap((item) => (item.type === "message" ? [item.message] : []));

    expect(sentToChannel!.broadcast).toEqual({ in: "thread", label: "チャンネルにも投稿しました" });
    expect(plain!.broadcast).toBeUndefined();
    // 注記は普通の返信と同じ見え方のままなので、続けて表示（grouped）は止めない
    expect(plain!.grouped).toBe(true);

    const withoutLabel = toThreadTimelineItems({ root, replies: [broadcast] }, { timeZone: tz });
    const shown = withoutLabel.flatMap((item) => (item.type === "message" ? [item.message] : []));

    expect(shown[1]!.broadcast).toBeUndefined();
  });

  it("shows my unsent reply in both places while it is still sending", () => {
    const outgoing = [
      {
        clientMsgId: "c-b",
        body: "送信中の返信",
        threadRootId: "m-1",
        alsoInChannel: true,
        attachments: [],
        status: "pending" as const,
        createdAt: "2026-09-13T01:03:00Z",
      },
    ];

    const channel = toTimelineItems([root], { unreadAfterSeq: null, me: naoki, outgoing, timeZone: tz });
    const thread = toThreadTimelineItems(
      { root, replies: [] },
      { me: naoki, outgoing, timeZone: tz, broadcastDoneLabel: alsoInChannelDoneLabel("public") },
    );

    expect(outline(channel)).toEqual(["[2026年9月13日]", "親", "送信中の返信"]);
    expect(channel.flatMap((i) => (i.type === "message" ? [i.message] : []))[1]!.broadcast).toEqual({ in: "channel" });
    expect(outline(thread)).toEqual(["親", "[2 replies]", "送信中の返信"]);
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
  const members = [roomMember(naoki, { online: true }), roomMember(miyuki), roomMember(kei, { online: true })];

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

describe("toTimelineItems のメンション", () => {
  /** 最初のメッセージの view を取り出す（日付の区切りを飛ばす）。 */
  function first(items: TimelineItem[]) {
    const item = items.find((i) => i.type === "message");
    if (item?.type !== "message") throw new Error("not a message");
    return item.message;
  }

  it("メンバーの表示名を引ける表を渡す", () => {
    const items = toTimelineItems([message(1, { body: `<@${naoki.id}> おはよう` })], {
      unreadAfterSeq: null,
      timeZone: tz,
      memberNames: { [naoki.id]: "佐藤 直樹" },
    });
    expect(first(items).mentionNames).toEqual({ [naoki.id]: "佐藤 直樹" });
  });

  it("ルームを抜けた人の名前は、メッセージの mentions が補う（ADR 0041）", () => {
    const items = toTimelineItems(
      [message(1, { body: `<@${kei.id}> ありがとう`, mentions: [{ kind: "user", user: kei }] })],
      { unreadAfterSeq: null, timeZone: tz, memberNames: { [naoki.id]: "佐藤 直樹" } },
    );
    expect(first(items).mentionNames).toEqual({ [naoki.id]: "佐藤 直樹", [kei.id]: "森田 圭" });
  });

  it("自分宛てに印を付ける", () => {
    const items = toTimelineItems([message(1, { sender: miyuki, mentions: [{ kind: "user", user: naoki }] })], {
      unreadAfterSeq: null,
      timeZone: tz,
      me: naoki,
    });
    expect(first(items).mentionsMe).toBe(true);
  });

  it("@channel と @here も自分宛てに数える", () => {
    const items = toTimelineItems([message(1, { sender: miyuki, mentions: [{ kind: "channel" }] })], {
      unreadAfterSeq: null,
      timeZone: tz,
      me: naoki,
    });
    expect(first(items).mentionsMe).toBe(true);
  });

  it("自分の発言は自分宛てにしない（ADR 0041）", () => {
    const items = toTimelineItems(
      [message(1, { sender: naoki, mentions: [{ kind: "user", user: naoki }, { kind: "channel" }] })],
      { unreadAfterSeq: null, timeZone: tz, me: naoki },
    );
    expect(first(items).mentionsMe).toBe(false);
  });

  it("他の人へのメンションだけなら自分宛てにしない", () => {
    const items = toTimelineItems([message(1, { sender: miyuki, mentions: [{ kind: "user", user: kei }] })], {
      unreadAfterSeq: null,
      timeZone: tz,
      me: naoki,
    });
    expect(first(items).mentionsMe).toBe(false);
  });

  it("送信中のメッセージは、まだ解釈されていないので自分宛てにならない", () => {
    const items = toTimelineItems([], {
      unreadAfterSeq: null,
      timeZone: tz,
      me: naoki,
      memberNames: { [naoki.id]: "佐藤 直樹" },
      outgoing: [
        {
          clientMsgId: "c-x",
          body: `<@${naoki.id}> メモ`,
          threadRootId: null,
          alsoInChannel: false,
          attachments: [],
          status: "pending",
          createdAt: "2026-09-13T01:01:00Z",
        },
      ],
    });
    expect(first(items)).toMatchObject({ mentionsMe: false, mentionNames: { [naoki.id]: "佐藤 直樹" } });
  });
});

describe("toTimelineItems の絵文字のリアクション（ADR 0044）", () => {
  function first(items: TimelineItem[]) {
    const item = items.find((i) => i.type === "message");
    if (item?.type !== "message") throw new Error("not a message");
    return item.message;
  }

  it("users の ID をメンバーの表示名に直し、自分は「あなた」にする", () => {
    const items = toTimelineItems(
      [message(1, { reactions: [{ emoji: "👍", count: 3, me: true, users: [naoki.id, miyuki.id] }] })],
      { unreadAfterSeq: null, timeZone: tz, me: naoki, memberNames: { [miyuki.id]: "高橋 みゆき" } },
    );

    expect(first(items).reactions).toEqual([
      { emoji: "👍", count: 3, me: true, names: ["あなた", "高橋 みゆき"] },
    ]);
  });

  it("名前を引けない ID（ルームを抜けた人）は落とす。数は count のまま", () => {
    const items = toTimelineItems([message(1, { reactions: [{ emoji: "🎉", count: 2, me: false, users: [kei.id] }] })], {
      unreadAfterSeq: null,
      timeZone: tz,
      memberNames: {},
    });

    expect(first(items).reactions).toEqual([{ emoji: "🎉", count: 2, me: false, names: [] }]);
  });

  it("配信には me が載らないので、無ければ false にする", () => {
    const items = toTimelineItems([message(1, { reactions: [{ emoji: "👀", count: 1, users: [] }] })], {
      unreadAfterSeq: null,
      timeZone: tz,
    });

    expect(first(items).reactions).toEqual([{ emoji: "👀", count: 1, me: false, names: [] }]);
  });

  it("送信中のメッセージにはリアクションを持たせない（まだ ID がない）", () => {
    const items = toTimelineItems([], {
      unreadAfterSeq: null,
      timeZone: tz,
      me: naoki,
      outgoing: [
        {
          clientMsgId: "c-1",
          body: "送信中",
          status: "pending",
          createdAt: "2026-09-13T01:00:00Z",
          threadRootId: null,
          alsoInChannel: false,
          attachments: [],
        },
      ],
    });

    expect(first(items).reactions).toEqual([]);
  });
});
