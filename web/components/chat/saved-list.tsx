"use client";

import Link from "next/link";

import { Avatar } from "@/components/ui/avatar";
import { IconButton } from "@/components/ui/button";
import {
  ArchiveIcon,
  BookmarkIcon,
  CheckIcon,
  ChevronLeftIcon,
  LockIcon,
  MoreIcon,
  PaperclipIcon,
  RestoreIcon,
  TrashIcon,
} from "@/components/ui/icons";
import { MenuItem } from "@/components/ui/menu-item";
import { Popover } from "@/components/ui/popover";
import { Tabs } from "@/components/ui/tabs";
import { cx } from "@/lib/cx";

import { MessageBody } from "./message-body";
import type { SavedItemView, SavedTab } from "./types";

type SavedListProps = {
  tab: SavedTab;
  onChangeTab?: (tab: SavedTab) => void;
  /** 「進行中」の件数（ADR 0054 決定 9 の `in_progress_count`）。件数を出すのは「進行中」のタブだけ（Slack と同じ）。 */
  inProgressCount: number;
  /** 選んでいるタブの行。保存した新しい順（並べるのはデータ層）。取得中は undefined。 */
  items?: SavedItemView[];
  /** 別のタブへ動かす（完了にする・アーカイブ・進行中に移動する）。 */
  onMove?: (key: string, to: SavedTab) => void;
  /** 「後で」から外す。 */
  onRemove?: (key: string) => void;
  /**
   * 読めない行を押した。中身が分からないまま外すことになるので、呼ぶ側が確認のダイアログを出す
   * （`RemoveSavedItemDialog`。Slack と同じ）。
   */
  onSelectUnavailable?: (key: string) => void;
  /** 「その他」を開いている行（1 度に 1 件）。 */
  openMenuKey?: string;
  onToggleMenu?: (key: string) => void;
  /** ホバーの見た目を固定で出す行（story で状態を再現するため）。 */
  hoveredKey?: string;
  /** モバイルで一覧に戻る。md 以上では出さない。 */
  onBack?: () => void;
};

const TABS: readonly { value: SavedTab; label: string }[] = [
  { value: "in_progress", label: "進行中" },
  { value: "archived", label: "アーカイブ済み" },
  { value: "completed", label: "完了済み" },
];

const EMPTY: Record<SavedTab, { title: string; hint: string }> = {
  in_progress: {
    title: "「後で」に保存したメッセージはありません",
    hint: "メッセージにポインタを乗せてブックマークのアイコンを押すと、ここに表示されます",
  },
  archived: {
    title: "アーカイブしたメッセージはありません",
    hint: "あとで参照したいメッセージをアーカイブすると、ここに残ります",
  },
  completed: {
    title: "完了したメッセージはありません",
    hint: "「完了にする」を押したメッセージは、ここに移ります",
  },
};

const PANEL_ID = "saved-panel";

/**
 * 「後で」（ADR 0054。Slack の「後で」）。サイドバーの「後で」から開き、スレッドの一覧と同じくルームの代わりにメインの領域に出す。
 * 行を押すと、そのメッセージへ飛ぶ（ADR 0042）。
 */
export function SavedList({
  tab,
  onChangeTab,
  inProgressCount,
  items,
  onMove,
  onRemove,
  onSelectUnavailable,
  openMenuKey,
  onToggleMenu,
  hoveredKey,
  onBack,
}: SavedListProps) {
  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-1 border-b border-border px-2 md:pr-3 md:pl-4">
        <IconButton label="チャンネル一覧に戻る" onClick={onBack} className="md:hidden">
          <ChevronLeftIcon className="size-5" />
        </IconButton>
        <div className="min-w-0 flex-1 pl-1 md:pl-0">
          <h1 className="text-lg font-bold text-text">後で</h1>
          <p className="text-2xs text-text-muted">自分だけに見える保存したメッセージ</p>
        </div>
      </header>

      <div className="shrink-0 px-4 md:px-6">
        <Tabs
          label="後で"
          items={TABS.map((item) => (item.value === "in_progress" ? { ...item, count: inProgressCount } : item))}
          value={tab}
          onChange={onChangeTab}
          panelId={PANEL_ID}
        />
      </div>

      <div id={PANEL_ID} role="tabpanel" className="flex min-h-0 flex-1 flex-col">
        {items === undefined ? null : items.length === 0 ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
            <BookmarkIcon className="size-6 text-text-muted" />
            <p className="text-lg font-medium text-text">{EMPTY[tab].title}</p>
            <p className="max-w-88 text-sm leading-relaxed text-text-muted">{EMPTY[tab].hint}</p>
          </div>
        ) : (
          <ul aria-label={TABS.find((item) => item.value === tab)?.label} className="min-h-0 flex-1 overflow-y-auto">
            {items.map((item) => (
              <li key={item.key} className="border-b border-border">
                {item.status === "unavailable" ? (
                  <UnavailableRow onSelect={() => onSelectUnavailable?.(item.key)} />
                ) : (
                  <SavedRow
                    item={item}
                    tab={tab}
                    onMove={(to) => onMove?.(item.key, to)}
                    onRemove={() => onRemove?.(item.key)}
                    menuOpen={openMenuKey === item.key}
                    onToggleMenu={() => onToggleMenu?.(item.key)}
                    forceHover={hoveredKey === item.key}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

/**
 * 読めない・削除済みの保存（ADR 0054 決定 8）。どちらかを区別しないので、中身も理由も出さない。
 * 行を消さずに残すのは Slack と同じで、押すと外すかどうかを確かめる。
 */
function UnavailableRow({ onSelect }: { onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full cursor-pointer items-center gap-2.5 px-4 py-3 text-left hover:bg-surface-muted md:px-6"
    >
      <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-surface-muted text-text-muted">
        <TrashIcon className="size-4" />
      </span>
      <span className="text-base text-text-muted">このメッセージは表示できません</span>
    </button>
  );
}

function SavedRow({
  item,
  tab,
  onMove,
  onRemove,
  menuOpen,
  onToggleMenu,
  forceHover,
}: {
  item: Extract<SavedItemView, { status: "ok" }>;
  tab: SavedTab;
  onMove: (to: SavedTab) => void;
  onRemove: () => void;
  menuOpen: boolean;
  onToggleMenu: () => void;
  forceHover: boolean;
}) {
  const { room } = item;
  return (
    <div
      className={cx(
        "group relative flex flex-col gap-1.5 px-4 py-3 md:px-6",
        forceHover || menuOpen ? "bg-surface-muted" : "hover:bg-surface-muted focus-within:bg-surface-muted",
      )}
    >
      {/* 行全体を押せるように、リンクを行の上に広げる。ホバーの操作だけはその上に重ねて押せるようにする */}
      <Link href={item.href} aria-label={`${item.sender.name} のメッセージへ移動`} className="absolute inset-0" />
      <span className="flex min-w-0 items-center gap-1 text-2xs font-medium text-text-secondary">
        {room.kind === "public" && <span aria-label="公開チャンネル">#</span>}
        {room.kind === "private" && <LockIcon aria-label="非公開チャンネル" aria-hidden={false} role="img" className="size-3" />}
        <span className="truncate">{room.name}</span>
      </span>
      <div className="flex gap-2.5">
        <Avatar id={item.sender.id} name={item.sender.name} imageUrl={item.sender.avatarUrl} size="sm" />
        <div className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="truncate text-sm font-semibold text-text">{item.sender.name}</span>
            <time className="shrink-0 font-mono text-2xs text-text-muted">{item.timeLabel}</time>
          </span>
          {item.body !== "" && (
            <MessageBody
              body={item.body}
              mentionNames={item.mentionNames}
              interactive={false}
              className="line-clamp-2 text-base leading-relaxed break-words text-text"
            />
          )}
          {item.attachmentCount > 0 && (
            <span className="flex items-center gap-1 pt-0.5 text-2xs text-text-muted">
              <PaperclipIcon className="size-3" />
              {item.attachmentCount} 件の添付
            </span>
          )}
        </div>
      </div>

      {/* ホバーの操作（Slack と同じく「完了」と「その他」。リマインダーは 6.14 の後。ADR 0054） */}
      <div
        className={cx(
          "absolute top-2 right-4 items-center rounded-sm border border-border bg-surface p-0.5 md:right-6",
          forceHover || menuOpen ? "flex" : "hidden group-hover:flex group-focus-within:flex max-md:flex",
        )}
      >
        {tab === "in_progress" && (
          <IconButton label="完了にする" title="完了にする" onClick={() => onMove("completed")} className="size-7">
            <CheckIcon className="size-4" />
          </IconButton>
        )}
        <IconButton
          label="その他の操作"
          aria-expanded={menuOpen}
          onClick={onToggleMenu}
          className={cx("size-7", menuOpen && "bg-surface-muted")}
        >
          <MoreIcon className="size-4" />
        </IconButton>
      </div>

      {menuOpen && (
        <Popover label="保存したメッセージの操作" className="top-11 right-4 w-52 md:right-6" onDismiss={onToggleMenu}>
          {tab !== "in_progress" && (
            <MenuItem icon={RestoreIcon} onClick={() => onMove("in_progress")}>
              進行中に移動する
            </MenuItem>
          )}
          {tab !== "archived" && (
            <MenuItem icon={ArchiveIcon} onClick={() => onMove("archived")}>
              アーカイブ
            </MenuItem>
          )}
          <MenuItem icon={BookmarkIcon} onClick={onRemove} danger>
            「後で」から外す
          </MenuItem>
        </Popover>
      )}
    </div>
  );
}
