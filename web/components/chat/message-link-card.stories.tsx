import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { users } from "@/stories/fixtures";

import { MessageLinkCard } from "./message-link-card";

/**
 * 本文に貼られたパーマリンクのカード（ADR 0040）。中身は**見る人の権限で取り直したもの**を props で受け取る。
 * 読めなければ `unavailable` になり、ルーム名も送信者も出さない（読めない・存在しない・削除済みを区別しない）。
 */
const meta = {
  title: "components/chat/MessageLinkCard",
  component: MessageLinkCard,
  tags: ["autodocs"],
  decorators: [(Story) => <div className="w-150">{Story()}</div>],
  args: {
    card: {
      key: "c-1",
      state: "ok",
      href: "#",
      room: { kind: "private", name: "リリース準備" },
      sender: { id: users.miyuki.id, name: users.miyuki.name },
      timeLabel: "昨日",
      body: "リリースの手順、いったん書き出しました。",
      clampedBody: "リリースの手順、いったん書き出しました。",
      clamped: false,
      attachmentCount: 0,
      inThread: false,
    },
  },
} satisfies Meta<typeof MessageLinkCard>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Ok: Story = { name: "読める" };

/** 長い本文は畳んで「すべて表示する」を出す。広げたかどうかはこの部品の中に持つ。 */
export const Clamped: Story = {
  name: "長い本文（畳む）",
  args: {
    card: {
      key: "c-2",
      state: "ok",
      href: "#",
      room: { kind: "private", name: "リリース準備" },
      sender: { id: users.miyuki.id, name: users.miyuki.name },
      timeLabel: "昨日",
      body: "リリースの手順、いったん書き出しました。develop から release ブランチを切って、バージョンを更新して、main への PR を作ってマージ。そのあと develop にも戻す PR を作ります。タグは main のマージコミットに打って、最後に Releases でリリースノートを書く、という流れです。",
      clampedBody: "リリースの手順、いったん書き出しました。develop から release ブランチを切って、バージョンを更新して、main への PR を作ってマージ。",
      clamped: true,
      attachmentCount: 1,
      inThread: true,
    },
  },
};

export const Expanded: Story = { name: "広げたところ", args: { ...Clamped.args, defaultExpanded: true } };

/** 読み込めたときに高さが変わってタイムラインがずれないよう、枠だけ先に置く。 */
export const Loading: Story = { name: "読み込み中", args: { card: { key: "c-3", state: "loading" } } };

export const Unavailable: Story = { name: "表示できない", args: { card: { key: "c-4", state: "unavailable" } } };

/** 別のワークスペースのメッセージを指しているときだけ、ワークスペース名を出す。 */
export const OtherWorkspace: Story = {
  name: "別のワークスペース",
  args: {
    card: {
      key: "c-5",
      state: "ok",
      href: "#",
      workspaceName: "山と印刷",
      room: { kind: "public", name: "一般" },
      sender: { id: users.naoki.id, name: users.naoki.name },
      timeLabel: "9月11日",
      body: "こちらでも同じ話をしていました。",
      clampedBody: "こちらでも同じ話をしていました。",
      clamped: false,
      attachmentCount: 0,
      inThread: false,
    },
  },
};
