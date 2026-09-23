import type { ReactNode } from "react";

import { cx } from "@/lib/cx";

/**
 * アイコンだけのボタンの上に、ホバー（またはキーボードのフォーカス）で名前を出す吹き出し。
 *
 * アイコンだけでは何のボタンか分からない（オーナーの指摘。Slack はホバーで名前を出す。2026-09-24）。
 * 見た目はリアクションの「誰が付けたか」の吹き出し（message-reactions.tsx）とそろえる。
 *
 * 名前は読み上げにはボタンの aria-label で伝えてあるので、吹き出しは aria-hidden にする
 * （role="tooltip" にすると、同じ名前を 2 度読むことになる）。
 * JS を使わず CSS の hover で出すので、行ごとに state を持たない。
 */
export function Tooltip({
  label,
  children,
  align = "center",
  suppressed = false,
  force = false,
}: {
  label: string;
  children: ReactNode;
  /** 吹き出しを寄せる向き。端のボタンは、はみ出して切れないよう内側に寄せる（`end` は右端をそろえる）。 */
  align?: "center" | "end";
  /** ボタンが開いたパネル（メニュー・ピッカー）と重なるので、開いている間は出さない。 */
  suppressed?: boolean;
  /** 吹き出しを固定で出す（story で状態を再現するため）。 */
  force?: boolean;
}) {
  return (
    <span className="group/tooltip relative flex">
      {children}
      {!suppressed && (
        <span
          aria-hidden
          className={cx(
            "pointer-events-none absolute bottom-full z-30 mb-1.5 w-max rounded-sm border border-border bg-surface px-2 py-1 text-2xs leading-normal text-text shadow-overlay",
            align === "end" ? "right-0" : "left-1/2 -translate-x-1/2",
            force ? "block" : "hidden group-hover/tooltip:block group-has-focus-visible/tooltip:block",
          )}
        >
          {label}
        </span>
      )}
    </span>
  );
}
