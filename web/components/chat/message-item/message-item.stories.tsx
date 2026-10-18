import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { users } from "@/stories/fixtures/users";

import { MessageItem } from "./message-item";
import type { MessageView } from "@/components/chat/types";

const miyuki = { id: users.miyuki.id, name: users.miyuki.name };
const you = { id: users.you.id, name: users.you.name };

/** 1 行ぶんの値。状態の軸（status / deleted / edited）だけを差し替えて並べる。 */
function view(extra: Partial<MessageView> = {}): MessageView {
  return {
    key: "m-1",
    sender: miyuki,
    timeLabel: "10:41",
    body: "行送りは 1.75 で確定にしましょう。半日開きっぱなしでも目が疲れませんでした。",
    status: "sent",
    deleted: false,
    edited: false,
    attachments: [],
    grouped: false,
    ...extra,
  };
}

/**
 * タイムラインの 1 行（ADR 0018）。送信の状態（pending / sent / failed）と、削除・編集済み・続けて表示を
 * ここだけで見比べられる。画面ぜんぶは `chat` の story にある。
 */
const meta = {
  title: "components/chat/MessageItem",
  component: MessageItem,
  tags: ["autodocs"],
  args: { message: view(), canReply: true },
  decorators: [(Story) => <div className="w-180 bg-surface py-2">{Story()}</div>],
} satisfies Meta<typeof MessageItem>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Sent: Story = { name: "sent（サーバーが seq を採番した）" };

/** 楽観的に出している行。時計のアイコンだけが付く。 */
export const Pending: Story = {
  name: "pending（送信中）",
  args: { message: view({ sender: you, body: "了解です。今日の夕方までに一覧を更新して、また共有します。", status: "pending" }) },
};

/** 送信できなかった行。再送は同じ client_msg_id で送るので二重投稿にならない。 */
export const Failed: Story = {
  name: "failed（送信できなかった）",
  args: { message: view({ sender: you, body: "はい、そろえるつもりです。", status: "failed" }), onRetry: () => {}, onDiscard: () => {} },
};

export const Edited: Story = { name: "編集済み", args: { message: view({ edited: true }) } };

/** 編集中。開いた時点で本文ぶんの高さになり、書き足せばさらに伸びる（上限 16 行）。 */
export const Editing: Story = {
  name: "編集中（本文ぶんの高さで開く）",
  args: {
    message: view({ sender: you }),
    canEdit: true,
    editing: {
      value:
        "行送りは 1.75 で確定にしましょう。\n" +
        "半日開きっぱなしにしてみましたが、目が疲れませんでした。\n" +
        "未読バッジの色だけ、まだ迷っています。",
    },
  },
};

/** 削除されたメッセージは画面から消すので（ADR 0038）、跡を残すのは返信の残るスレッドの親だけ。 */
export const Deleted: Story = {
  name: "削除された（スレッドの親だけ跡を残す）",
  args: { message: view({ body: "", deleted: true, thread: { replyCount: 3, lastReplyLabel: "10:02" } }) },
};

export const Grouped: Story = {
  name: "続けて表示（同じ人の次の発言）",
  args: { message: view({ grouped: true, body: "未読バッジの色だけ、まだ迷っています。" }) },
};

export const Attachments: Story = {
  name: "添付つき",
  args: {
    message: view({
      attachments: [
        { kind: "image", id: "a-1", fileName: "サイドバー改訂 01", width: 260, height: 160 },
        { kind: "file", id: "a-2", fileName: "hibari-type-scale.pdf", sizeLabel: "248 KB" },
      ],
    }),
    onOpenImage: () => {},
    onDownload: () => {},
  },
};

export const Reactions: Story = {
  name: "リアクションつき",
  args: {
    message: view({
      reactions: [
        { emoji: "👍", count: 5, me: true, names: [users.naoki.name, users.ryo.name, users.you.name] },
        { emoji: "🎉", count: 2, me: false, names: [users.naoki.name, users.miyuki.name] },
      ],
    }),
    onToggleReaction: () => {},
    onTogglePicker: () => {},
  },
};

/** 自分宛てのメンションがある行は背景を琥珀にし、左端に縦線を引く（ADR 0043）。 */
export const MentionsMe: Story = {
  name: "自分宛てのメンションがある",
  args: {
    message: view({
      body: `<@${users.you.id}> サイドバーのバッジの色、決まりました？`,
      mentionNames: { [users.you.id]: users.you.name },
      mentionsMe: true,
    }),
  },
};

export const Thread: Story = {
  name: "スレッドの親（N 件の返信）",
  args: { message: view({ thread: { replyCount: 5, lastReplyLabel: "10:02" } }), onOpenThread: () => {} },
};

/** ホバーの操作（返信・「…」）を出したところ。実際はマウスを乗せたときだけ出る。 */
export const HoverActions: Story = {
  name: "ホバーの操作",
  args: { message: view({ sender: you }), forceHover: true, canEdit: true, canDelete: true, onReply: () => {}, onToggleMenu: () => {} },
};

export const States: Story = {
  name: "状態の一覧",
  render: () => (
    <div className="flex flex-col gap-1">
      <MessageItem message={view({ sender: you, body: "送信中の行です。", status: "pending" })} />
      <MessageItem message={view({ sender: you, body: "送信できなかった行です。", status: "failed" })} onRetry={() => {}} onDiscard={() => {}} />
      <MessageItem message={view({ body: "届いた行です。" })} />
      <MessageItem message={view({ body: "編集済みの行です。", edited: true })} />
    </div>
  ),
};
