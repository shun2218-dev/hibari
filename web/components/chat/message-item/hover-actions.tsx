"use client";

import { IconButton } from "@/components/ui/button";
import { BookmarkIcon, MoreIcon, ReplyIcon, SmilePlusIcon } from "@/components/ui/icons";
import { Tooltip } from "@/components/ui/tooltip";
import { cx } from "@/lib/cx";

/**
 * メッセージの行に乗せたときに出る操作（ADR 0027 / 0044 / 0054）。
 * 出す・出さないの判定は MessageItem が持ち、ここは渡されたものを並べるだけ。
 *
 * アイコンだけでは何の操作か分からないので、ホバーで名前の吹き出しを出す（Slack と同じ）。
 */
export type HoverAction = "react" | "reply" | "save" | "more";

export function HoverActions({
  forceHover,
  forceTooltip,
  canReact,
  pickerOpen,
  onTogglePicker,
  canReply,
  onReply,
  save,
  hasMenu,
  menuOpen,
  onToggleMenu,
}: {
  forceHover?: boolean;
  /** 名前の吹き出しを固定で出す操作（story で状態を再現するため）。 */
  forceTooltip?: HoverAction;
  canReact: boolean;
  pickerOpen: boolean;
  onTogglePicker?: () => void;
  canReply: boolean;
  onReply?: () => void;
  /** 「後で」に保存できるとき（送信済みで削除されていない）だけ渡す。 */
  save?: { saved: boolean; onClick: () => void };
  hasMenu: boolean;
  menuOpen: boolean;
  onToggleMenu?: () => void;
}) {
  // いちばん右に来るボタンの吹き出しは右端をそろえる（中央に置くとタイムラインの右端で切れる）。
  // どれが右端かは、出せる操作によって変わる（他人のメッセージは「…」がないことがある）。
  const last: HoverAction = hasMenu ? "more" : save ? "save" : canReply ? "reply" : "react";
  const align = (action: HoverAction) => (action === last ? "end" : "center");

  return (
    <div
      className={cx(
        "absolute -top-3 right-4 items-center rounded-sm border border-border bg-surface p-0.5",
        forceHover ? "flex" : "hidden group-hover:flex group-focus-within:flex",
      )}
    >
      {canReact && (
        <Tooltip label="リアクションを追加" align={align("react")} suppressed={pickerOpen} force={forceTooltip === "react"}>
          <IconButton
            label="リアクションを追加"
            aria-expanded={pickerOpen}
            onClick={onTogglePicker}
            className={cx("size-7", pickerOpen && "bg-surface-muted")}
          >
            <SmilePlusIcon className="size-4" />
          </IconButton>
        </Tooltip>
      )}
      {canReply && (
        <Tooltip label="スレッドで返信する" align={align("reply")} force={forceTooltip === "reply"}>
          <IconButton label="スレッドで返信する" onClick={onReply} className="size-7">
            <ReplyIcon className="size-4" />
          </IconButton>
        </Tooltip>
      )}
      {save && (
        <Tooltip label={saveLabel(save.saved)} align={align("save")} force={forceTooltip === "save"}>
          <IconButton label={saveLabel(save.saved)} aria-pressed={save.saved} onClick={save.onClick} className="size-7">
            {/* IconButton の文字色（text-secondary）より後に効かせるため、色はアイコンの側に付ける */}
            <BookmarkIcon className={cx("size-4", save.saved && "text-primary")} fill={save.saved ? "currentColor" : "none"} />
          </IconButton>
        </Tooltip>
      )}
      {hasMenu && (
        <Tooltip label="その他の操作" align={align("more")} suppressed={menuOpen} force={forceTooltip === "more"}>
          <IconButton
            label="その他の操作"
            aria-expanded={menuOpen}
            onClick={onToggleMenu}
            className={cx("size-7", menuOpen && "bg-surface-muted")}
          >
            <MoreIcon className="size-4" />
          </IconButton>
        </Tooltip>
      )}
    </div>
  );
}

function saveLabel(saved: boolean): string {
  return saved ? "「後で」から外す" : "「後で」に保存";
}
