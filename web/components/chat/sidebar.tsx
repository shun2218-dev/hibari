import Link from "next/link";
import type { ComponentType, ReactNode } from "react";

import { Avatar } from "@/components/ui/avatar";
import { UnreadBadge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { BookmarkIcon, ChevronDownIcon, HashIcon, LockIcon, PlusIcon, SearchIcon, ThreadIcon } from "@/components/ui/icons";
import { cx } from "@/lib/cx";

import type { RoomSummaryView, UserRef, WorkspaceRef } from "./types";
import { StatusEmoji } from "./user-status";

type SidebarProps = {
  workspace: WorkspaceRef;
  currentUser: UserRef;
  rooms: RoomSummaryView[];
  selectedRoomId?: string;
  roomHref: (roomId: string) => string;
  search?: string;
  onSearchChange?: (value: string) => void;
  switcherOpen?: boolean;
  onToggleSwitcher?: () => void;
  /** ワークスペースの切り替えのポップオーバー。switcherOpen のときだけ出す。 */
  switcher?: ReactNode;
  accountMenuOpen?: boolean;
  onToggleAccountMenu?: () => void;
  /** 自分のアバターから開くメニュー。accountMenuOpen のときだけ出す。 */
  accountMenu?: ReactNode;
  onCreateRoom?: () => void;
  /** ダイレクトメッセージを始める（相手を選ぶダイアログを開く）。 */
  onStartDm?: () => void;
  /**
   * 参加しているスレッドの一覧への入口（ADR 0036）。unreadCount は未読のあるスレッドの数。
   * 渡さなければ出さない。
   */
  threads?: { href: string; unreadCount: number; selected: boolean };
  /**
   * 「後で」の一覧への入口（ADR 0054）。Phase 6.14.5 でサイドバーの左のメニューができたら、そちらへ移る。
   * 件数は出さない（未読ではないので、琥珀のバッジで呼ばない）。渡さなければ出さない。
   */
  saved?: { href: string; selected: boolean };
  /** 検索の下に置く帯（「デスクトップ通知を有効にする」。ADR 0057）。渡さなければ出さない。 */
  notice?: ReactNode;
  /**
   * md 以上で左のメニュー（`SideNavRail`）と並べる。自分のアバターはメニューの下に移るので、md 以上ではここに出さない（ADR 0058）。
   * モバイルにはメニューの列がないので、いままでどおりここに出す。
   */
  railed?: boolean;
};

export function Sidebar({
  workspace,
  currentUser,
  rooms,
  selectedRoomId,
  roomHref,
  search = "",
  onSearchChange,
  switcherOpen = false,
  onToggleSwitcher,
  switcher,
  accountMenuOpen = false,
  onToggleAccountMenu,
  accountMenu,
  onCreateRoom,
  onStartDm,
  threads,
  saved,
  notice,
  railed = false,
}: SidebarProps) {
  const channels = rooms.filter((room) => room.kind !== "dm");
  const dms = rooms.filter((room) => room.kind === "dm");
  // 検索して 0 件なのか、まだチャンネルがないのかで、出すものが違う
  const searching = search.trim() !== "";

  return (
    <nav aria-label="チャンネル" className="flex h-full flex-col bg-surface">
      <div className="relative flex h-16 shrink-0 items-center gap-2 px-3">
        <button
          type="button"
          onClick={onToggleSwitcher}
          aria-expanded={switcherOpen}
          aria-haspopup="dialog"
          className={cx(
            "flex h-10 min-w-0 flex-1 items-center gap-2 rounded-md border px-2.5 text-left",
            switcherOpen ? "border-border bg-surface-muted" : "border-transparent hover:bg-surface-muted",
          )}
        >
          <Avatar id={workspace.id} name={workspace.name} size="xs" shape="square" />
          <span className="flex-1 truncate text-base font-bold text-text">{workspace.name}</span>
          <ChevronDownIcon className="size-4 shrink-0 text-text-secondary" />
        </button>
        <button
          type="button"
          onClick={onToggleAccountMenu}
          aria-label="アカウントメニュー"
          aria-expanded={accountMenuOpen}
          aria-haspopup="dialog"
          className={cx("rounded-full", railed && "md:hidden")}
        >
          <Avatar id={currentUser.id} name={currentUser.name} imageUrl={currentUser.avatarUrl} size="sm" />
        </button>
        {switcherOpen && switcher}
        {accountMenuOpen && accountMenu}
      </div>

      <div className="px-3 pb-2">
        <label className="flex h-8.5 items-center gap-2 rounded-sm border border-border px-2.5 has-focus-visible:outline-2 has-focus-visible:-outline-offset-2 has-focus-visible:outline-primary">
          <SearchIcon className="size-4 shrink-0 text-text-secondary" />
          <input
            type="search"
            aria-label="チャンネルを検索"
            placeholder="チャンネルを検索"
            value={search}
            onChange={(e) => onSearchChange?.(e.target.value)}
            className="min-w-0 flex-1 bg-transparent text-sm text-text focus-visible:outline-none"
          />
        </label>
      </div>

      {notice}

      {rooms.length === 0 ? (
        <div className="flex flex-col items-center gap-1 px-4 pt-12 text-center">
          <p className="text-base font-medium text-text">
            {searching ? "一致するチャンネルがありません" : "まだチャンネルがありません"}
          </p>
          <p className="text-xs leading-relaxed text-text-muted">
            {searching ? "別の言葉を試すか、チャンネルを作成してください" : "誰かを招待して会話を始めましょう"}
          </p>
          {!searching && (
            <Button onClick={onCreateRoom} className="mt-4">
              チャンネルを作成
            </Button>
          )}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto pb-4">
          {/* 検索はチャンネルを探すためのものなので、検索している間は出さない */}
          {(threads || saved) && !searching && (
            <div className="pt-3">
              {threads && (
                <NavRow href={threads.href} selected={threads.selected} icon={ThreadIcon} unreadCount={threads.unreadCount}>
                  スレッド
                </NavRow>
              )}
              {saved && (
                <NavRow href={saved.href} selected={saved.selected} icon={BookmarkIcon}>
                  後で
                </NavRow>
              )}
            </div>
          )}
          {/* 片方が 0 件でも見出しは出す。「+」がそのまま作成・DM の入口になっている */}
          <RoomSection title="チャンネル" first action={{ label: "チャンネルを作成", onClick: onCreateRoom }}>
            {channels.map((room) => (
              <RoomRow key={room.id} room={room} href={roomHref(room.id)} selected={room.id === selectedRoomId} />
            ))}
          </RoomSection>
          <RoomSection
            title="ダイレクトメッセージ"
            first={false}
            action={{ label: "ダイレクトメッセージを開く", onClick: onStartDm }}
          >
            {dms.map((room) => (
              <RoomRow key={room.id} room={room} href={roomHref(room.id)} selected={room.id === selectedRoomId} />
            ))}
          </RoomSection>
        </div>
      )}
    </nav>
  );
}

/**
 * ルームの一覧の上に置く行（「スレッド」と「後で」）。
 * スレッドの未読は、チャンネルと同じ琥珀のバッジで「未読のあるスレッドの数」を出す。
 * スレッドの返信はチャンネルの未読に数えないので（ADR 0036）、ここが返信に気づく唯一の場所になる。
 * 「後で」は未読ではないので、バッジを出さない（ADR 0054）。
 */
function NavRow({
  href,
  selected,
  icon: Icon,
  unreadCount = 0,
  children,
}: {
  href: string;
  selected: boolean;
  icon: ComponentType<{ className?: string }>;
  unreadCount?: number;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={selected ? "page" : undefined}
      className={cx("relative flex h-9 items-center gap-3 px-4", selected ? "bg-primary-subtle" : "hover:bg-surface-muted")}
    >
      {selected && <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-primary" />}
      <Icon className="size-4 shrink-0 text-text-secondary" />
      <span className={cx("flex-1 text-base text-text", unreadCount > 0 ? "font-bold" : "font-semibold")}>{children}</span>
      <UnreadBadge count={unreadCount} />
    </Link>
  );
}

/**
 * 見出しの右の「+」は、そのまとまりを増やす入口（チャンネルの作成、DM を開く）。
 * ルームが 0 件のときは一覧ごと出ないので、空のときの「チャンネルを作成」のボタンは別に残してある。
 */
function RoomSection({
  title,
  first,
  action,
  children,
}: {
  title: string;
  first: boolean;
  action: { label: string; onClick?: () => void };
  children: ReactNode;
}) {
  return (
    <section className={first ? "pt-4" : "pt-3"}>
      <div className="flex items-center justify-between gap-2 px-4 pb-2 pr-2.5">
        <h2 className="text-2xs font-medium text-text-secondary">{title}</h2>
        <IconButton label={action.label} onClick={action.onClick}>
          <PlusIcon className="size-3.5" />
        </IconButton>
      </div>
      <ul>{children}</ul>
    </section>
  );
}

export function RoomRow({ room, href, selected }: { room: RoomSummaryView; href: string; selected: boolean }) {
  // ミュートしたルームは隠さずに薄くする（ADR 0055 決定 6）。未読は太字にせず、メンションの @N だけを残す
  const muted = room.muted ?? false;
  return (
    <li>
      <Link
        href={href}
        aria-current={selected ? "page" : undefined}
        className={cx(
          "relative flex items-center gap-3 px-4 py-2",
          selected ? "bg-primary-subtle" : "hover:bg-surface-muted",
          room.kind === "dm" && "gap-2.5",
        )}
      >
        {selected && <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-primary" />}
        {room.kind === "dm" ? (
          <Avatar
            id={room.peer?.id ?? room.id}
            name={room.name}
            imageUrl={room.peer?.avatarUrl}
            size="md"
            presence={room.peer?.presence}
          />
        ) : (
          <span className={cx("flex w-4 shrink-0 justify-center self-start pt-1", muted ? "text-text-muted" : "text-text-secondary")}>
            {room.kind === "public" ? (
              <HashIcon aria-label="公開" aria-hidden={false} role="img" className="size-4" />
            ) : (
              <LockIcon aria-label="非公開" aria-hidden={false} role="img" className="size-3.5" />
            )}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            {/* 知らせの要らない未読は、バッジではなく名前の太字で示す（ADR 0043） */}
            {/* ステータスの絵文字は名前のすぐ横に置く。時刻と同じ並びに入れると、名前から離れて右端に寄ってしまう */}
            <span className="flex min-w-0 items-baseline gap-1">
              <span
                className={cx(
                  "truncate text-base",
                  muted ? "text-text-muted" : "text-text",
                  room.unreadCount > 0 && !muted ? "font-bold" : "font-semibold",
                )}
              >
                {room.name}
                {/* 薄い色だけでは読み上げで分からないので、言葉でも添える */}
                {muted && <span className="sr-only">（ミュート中）</span>}
              </span>
              {room.peer?.status && <StatusEmoji status={room.peer.status} className="text-xs" />}
            </span>
            {room.timeLabel && <span className="shrink-0 font-mono text-2xs text-text-muted">{room.timeLabel}</span>}
          </span>
          <span className="flex items-center justify-between gap-2">
            <span className="truncate text-xs text-text-muted">{room.lastMessage}</span>
            {/*
              数字のバッジは知らせが要るものだけ（ADR 0043）。チャンネルは自分宛てのメンションの数、
              DM は 1 通が知らせなので未読の数をそのまま出す。ただの未読のチャンネルには出さない。
              ミュートした DM は、チャンネルと同じくメンションの数だけにする（ADR 0055 決定 6）。
            */}
            {room.kind === "dm" && !muted ? (
              <UnreadBadge count={room.unreadCount} />
            ) : (
              <UnreadBadge count={room.mentionCount} mention />
            )}
          </span>
        </span>
      </Link>
    </li>
  );
}
