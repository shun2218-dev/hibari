import type { MessageReactionView, TimelineItem } from "@/components/chat/types";

import { timeline } from "./timeline";
import { users } from "./users";

/**
 * 絵文字のリアクション（ADR 0044）。
 */
// ---- 絵文字のリアクション（ADR 0044）----

/** リアクションの付いているメッセージの key（chat/reaction/reaction-names.png のホバーに使う）。 */
export const reactedMessageKey = "m-1030";

/** ピッカーを開いているメッセージの key（chat/reaction/reaction-picker.png）。まだ何も付いていない行から開く。 */
export const reactionPickerKey = "m-1012";

/** ホバーで名前を出しているリアクション（chat/reaction/reaction-names.png）。 */
export const hoveredReaction = { key: reactedMessageKey, emoji: "👍" };

const reactionsByKey: Record<string, MessageReactionView[]> = {
  // 自分が付けているもの（緑）と、付けていないもの（枠だけ）を 1 行に並べる
  [reactedMessageKey]: [
    { emoji: "👍", count: 5, me: true, names: [users.miyuki.name, users.ryo.name, users.you.name] },
    { emoji: "🎉", count: 2, me: false, names: [users.naoki.name, users.misaki.name] },
    { emoji: "👀", count: 1, me: false, names: [users.haru.name] },
  ],
  // 1 種類だけ・自分は付けていない
  "m-1105": [{ emoji: "💯", count: 1, me: false, names: [users.miyuki.name] }],
  // 数の多いもの。名前は先頭 8 人までしか来ないので「他 N 人」になる（ADR 0044 決定 3）
  "m-1041": [
    {
      emoji: "🙏",
      count: 12,
      me: true,
      names: [users.you.name, users.naoki.name, users.ryo.name, users.misaki.name],
    },
  ],
};

/** リアクションの付いたタイムライン（chat/reaction/reactions.png）。 */
export const timelineWithReactions: TimelineItem[] = timeline.map((item) =>
  item.type === "message" && reactionsByKey[item.message.key] !== undefined
    ? { type: "message", message: { ...item.message, reactions: reactionsByKey[item.message.key] } }
    : item,
);
