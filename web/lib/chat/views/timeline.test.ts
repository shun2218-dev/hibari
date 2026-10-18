import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { TimelineItem } from "@/components/chat/types";
import { systemMessageText } from "@/lib/chat/views/message";
import { alsoInChannelDoneLabel, toRoomSummaryView } from "@/lib/chat/views/rooms";
import { toThreadTimelineItems } from "@/lib/chat/views/threads";
import { toTimelineItems } from "@/lib/chat/views/timeline";
import { kei, message, miyuki, naoki, room, systemMessage } from "@/test/chat-data";
import {
  LINK_KEY,
  LINK_MSG,
  LINK_ROOM,
  OTHER_WS,
  PERMALINK,
  WS,
  cardsOf,
  linkMessage,
  linkResult,
  outline,
  pdf,
  png,
  tz,
} from "@/test/views";

// 日付の区切りは「今年なら年を省く」ので、今日を固定する（東京で 2026/9/24）
beforeAll(() => {
  vi.useFakeTimers({ now: new Date("2026-09-24T03:00:00Z"), toFake: ["Date"] });
});
afterAll(() => {
  vi.useRealTimers();
});

describe("toTimelineItems", () => {
  it("inserts a date divider whenever the local day changes", () => {
    const items = toTimelineItems(
      [
        message(1, { body: "a", created_at: "2026-09-12T14:00:00Z" }), // 東京で 9/12 23:00
        message(2, { body: "b", created_at: "2026-09-12T15:30:00Z", sender: naoki }), // 9/13 00:30
      ],
      { unreadAfterSeq: null, timeZone: tz },
    );

    expect(outline(items)).toEqual(["[9月12日]", "a", "[9月13日]", "b"]);
  });

  it("shows the year on date dividers only for other years", () => {
    const items = toTimelineItems(
      [
        message(1, { body: "a", created_at: "2025-12-31T03:00:00Z" }),
        message(2, { body: "b", created_at: "2026-01-01T03:00:00Z", sender: naoki }),
      ],
      { unreadAfterSeq: null, timeZone: tz, now: new Date("2026-09-24T03:00:00Z") },
    );

    expect(outline(items)).toEqual(["[2025年12月31日]", "a", "[1月1日]", "b"]);
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

    expect(outline(items)).toEqual(["[9月13日]", "a", "+b", "c", "d", "+e"]);
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
    expect(outline(items)).toEqual(["[9月13日]", "親", "[unread]", "チャンネル"]);
  });

  it("puts the unread divider before the first message after the last read seq and breaks the group there", () => {
    const items = toTimelineItems([message(1, { body: "a" }), message(2, { body: "b" }), message(3, { body: "c" })], {
      unreadAfterSeq: 1,
      timeZone: tz,
    });

    expect(outline(items)).toEqual(["[9月13日]", "a", "[unread]", "b", "+c"]);
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

    expect(outline(items)).toEqual(["[9月13日]", "a", "[unread]", "c"]);
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

    expect(outline(items)).toEqual(["[9月13日]", "a", "[unread]", "b", "送信中", "+失敗"]);
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
      "[9月13日]",
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
      "[9月13日]",
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

describe("ハドルのメッセージ（ADR 0066 決定 12）", () => {
  const huddleMessage = (ended_at: string | null) =>
    systemMessage(2, { type: "huddle", huddle_id: "h-1" }, {
      sender: miyuki,
      huddle: { id: "h-1", started_at: "2026-09-13T01:00:00Z", ended_at, participant_ids: [miyuki.id, naoki.id] },
      thread: { reply_count: 2, last_thread_seq: 4, last_reply_at: "2026-09-13T01:05:00Z" },
    });

  it("ログの 1 行ではなくハドルの行にし、スレッドの返信の数を載せる", () => {
    const items = toTimelineItems([message(1, { sender: miyuki }), huddleMessage(null), message(3, { sender: miyuki })], {
      unreadAfterSeq: null,
      timeZone: tz,
      me: naoki,
      memberNames: { [miyuki.id]: miyuki.display_name },
    });

    const huddle = items.find((i) => i.type === "huddle");
    expect(huddle).toMatchObject({
      type: "huddle",
      huddle: { key: "m-2", state: "active", joined: true, thread: { replyCount: 2 } },
    });
    // ハドルの行を挟んだら、前後の同じ人の発言を続けて表示にしない
    expect(outline(items)).toEqual(["[9月13日]", "本文 1", "[huddle: active]", "本文 3"]);
  });

  it("DM で終わったら、入った人には「終了」になる", () => {
    const items = toTimelineItems([huddleMessage("2026-09-13T01:12:00Z")], { unreadAfterSeq: null, timeZone: tz, me: naoki, roomKind: "dm" });
    expect(items.find((i) => i.type === "huddle")).toMatchObject({ huddle: { state: "ended", durationLabel: "12 分" } });
  });
});

describe("toTimelineItems のリンクのカード", () => {
  it("カードの本文のメンションには、ワークスペースのメンバーの名前を渡す（ADR 0051）", () => {
    const names = { [naoki.id]: "佐藤 直樹" };
    const [card] = cardsOf([message(1, { body: PERMALINK })], { [LINK_KEY]: linkResult() }, { workspaceMemberNames: names }) ?? [];
    expect(card).toMatchObject({ state: "ok", mentionNames: names });
  });

  it("コードの中のパーマリンクはカードにしない（ADR 0051 決定 4）", () => {
    expect(cardsOf([message(1, { body: `\`${PERMALINK}\`` })], {})).toBeUndefined();
  });

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
    expect(outline(items)).toEqual(["[9月13日]", "親", "流した返信", "あと"]);
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

    expect(outline(items)).toEqual(["[9月13日]", "親", "[unread]", "流した返信"]);
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

    expect(outline(channel)).toEqual(["[9月13日]", "親", "送信中の返信"]);
    expect(channel.flatMap((i) => (i.type === "message" ? [i.message] : []))[1]!.broadcast).toEqual({ in: "channel" });
    expect(outline(thread)).toEqual(["親", "[2 replies]", "送信中の返信"]);
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
