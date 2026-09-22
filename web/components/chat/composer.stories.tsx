import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { mentionCandidates } from "@/stories/fixtures/timeline";
import { users } from "@/stories/fixtures/users";

import { Composer } from "./composer";

/**
 * 入力欄（ADR 0027）。本文・添付・入力中の名前・`@` の補完を持つ。
 * 送れるかどうか（`canSend`）は外から渡す（本文が空白だけ、アップロード中の添付がある、など）。
 */
const meta = {
  title: "components/chat/Composer",
  component: Composer,
  tags: ["autodocs"],
  args: { value: "", canSend: false, target: "room" },
  argTypes: { target: { control: "inline-radio", options: ["room", "thread"] } },
  decorators: [(Story) => <div className="w-180 bg-surface">{Story()}</div>],
} satisfies Meta<typeof Composer>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Empty: Story = { name: "空（送れない）" };

export const Typing: Story = { name: "入力した（送れる）", args: { value: "金曜の件、あとで画面で見ます。", canSend: true } };

/** 改行や折り返しで増えた分だけ縦に伸びる。上限（16 行）まで来たら、そこから先は中でスクロールする。 */
export const MultiLine: Story = {
  name: "複数行（伸びる）",
  args: {
    value:
      "行送りは 1.75 で確定にしましょう。\n" +
      "半日開きっぱなしにしてみましたが、目が疲れませんでした。\n" +
      "未読バッジの色だけ、まだ迷っています。明日の画面で見てから決めます。",
    canSend: true,
  },
};

/** 入力中の表示は琥珀（「いま起きていること」）。 */
export const TypingNames: Story = {
  name: "相手が入力中",
  args: { typingNames: [users.miyuki.name] },
};

export const Attachments: Story = {
  name: "添付（アップロード中・失敗・完了）",
  args: {
    attachments: [
      { id: "up-1", fileName: "サイドバー改訂.fig", status: "uploading", progress: 62 },
      { id: "up-2", fileName: "行送りの比較.png", status: "failed" },
      { id: "up-3", fileName: "hibari-type-scale.pdf", status: "uploaded", sizeLabel: "1.8 MB" },
    ],
    onRetryAttachment: () => {},
    onRemoveAttachment: () => {},
  },
};

/** スレッドの入力欄（ADR 0036）。同じ画面に 2 つ並ぶので、読み上げの名前と案内を分ける。 */
export const Thread: Story = {
  name: "スレッド（チャンネルにも投稿する）",
  args: { target: "thread", alsoInChannel: { label: "チャンネルにも投稿する", checked: false } },
};

/** `@` を打つと補完が開く（ADR 0043）。個人が先、`@channel` / `@here` は前方一致したときだけ後ろに出す。 */
export const MentionCompletion: Story = {
  name: "@ の補完",
  args: { value: "金曜の件、@", canSend: true, mentionCandidates, forceMentionQuery: "" },
};

export const MentionCompletionTyped: Story = {
  name: "@ の補完（名前で絞った）",
  args: { value: "金曜の件、@n", canSend: true, mentionCandidates, forceMentionQuery: "n" },
};
