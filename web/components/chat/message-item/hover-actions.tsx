"use client";

import { IconButton } from "@/components/ui/button";
import { BookmarkIcon, MoreIcon, ReplyIcon, SmilePlusIcon } from "@/components/ui/icons";
import { cx } from "@/lib/cx";

/**
 * メッセージの行に乗せたときに出る操作（ADR 0027 / 0044 / 0054）。
 * 出す・出さないの判定は MessageItem が持ち、ここは渡されたものを並べるだけ。
 */
export function HoverActions({
  forceHover,
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
  return (
    <div
      className={cx(
        "absolute -top-3 right-4 items-center rounded-sm border border-border bg-surface p-0.5",
        forceHover ? "flex" : "hidden group-hover:flex group-focus-within:flex",
      )}
    >
      {canReact && (
        <IconButton
          label="リアクションを追加"
          aria-expanded={pickerOpen}
          onClick={onTogglePicker}
          className={cx("size-7", pickerOpen && "bg-surface-muted")}
        >
          <SmilePlusIcon className="size-4" />
        </IconButton>
      )}
      {canReply && (
        <IconButton label="返信" onClick={onReply} className="size-7">
          <ReplyIcon className="size-4" />
        </IconButton>
      )}
      {save && (
        <IconButton
          label={save.saved ? "「後で」から外す" : "「後で」に保存"}
          aria-pressed={save.saved}
          onClick={save.onClick}
          className="size-7"
        >
          {/* IconButton の文字色（text-secondary）より後に効かせるため、色はアイコンの側に付ける */}
          <BookmarkIcon className={cx("size-4", save.saved && "text-primary")} fill={save.saved ? "currentColor" : "none"} />
        </IconButton>
      )}
      {hasMenu && (
        <IconButton
          label="その他の操作"
          aria-expanded={menuOpen}
          onClick={onToggleMenu}
          className={cx("size-7", menuOpen && "bg-surface-muted")}
        >
          <MoreIcon className="size-4" />
        </IconButton>
      )}
    </div>
  );
}
