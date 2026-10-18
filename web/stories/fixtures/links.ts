import type { MessageLinkCardView, TimelineItem } from "@/components/chat/types";

import { timeline } from "./timeline";
import { miyuki } from "./users";

/**
 * 本文に貼られたパーマリンクのカード（ADR 0040）。
 */
/**
 * 本文に貼られたパーマリンクのカード（chat/link/message-link-card.png。ADR 0040）。
 * 読めるリンクは中身を出し、読めない・存在しない・削除済みは区別せずに「表示できません」にする。
 */
const linkCards: MessageLinkCardView[] = [
  {
    key: "card-ok",
    state: "ok",
    href: "#",
    room: { kind: "private", name: "リリース準備" },
    sender: miyuki,
    timeLabel: "昨日",
    body:
      "リリースの手順、いったん書き出しました。develop から release ブランチを切って、バージョンを更新して、main への PR を作ってマージ、そのあと develop にも戻す PR を作ります。タグは main のマージコミットに打って、最後に Releases でリリースノートを書く、という流れです。ここまでで詰まりそうなところがあれば教えてください。次のリリースからは手順書として使えるように、このメッセージをピン留めしておくつもりです。手順の細かいところは ADR とロードマップにも書いてあるので、あわせて見てもらえると助かります。抜けがあれば、このスレッドで指摘してください。",
    clampedBody:
      "リリースの手順、いったん書き出しました。develop から release ブランチを切って、バージョンを更新して、main への PR を作ってマージ、そのあと develop にも戻す PR を作ります。タグは main のマージコミットに打って、最後に Releases でリリースノートを書く、という流れです。ここまでで詰まりそうなところがあれば教えてください。次のリリースからは手順書として使えるように、このメッセージをピン留めしておくつもりです。手順の細かいところは ADR とロードマップにも書いてあるので、あわせて見てもらえると助かります。抜けがあれば、このスレッドで指摘してくださ…",
    clamped: true,
    attachmentCount: 1,
    inThread: false,
  },
  { key: "card-unavailable", state: "unavailable" },
];

/** 本文にリンクを貼ったタイムライン（chat/link/message-link-card.png）。 */
export const timelineWithLinkCards: TimelineItem[] = timeline.map((item) =>
  item.type === "message" && item.message.key === "m-1030"
    ? {
        type: "message",
        message: {
          ...item.message,
          body: "手順はこのメッセージにまとまっています。あとこっちも見てもらえますか。",
          linkCards,
        },
      }
    : item,
);
