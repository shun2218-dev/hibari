import Link from "next/link";
import type { ReactNode } from "react";

import { Avatar } from "@/components/ui/avatar";
import { UnreadBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDownIcon, HashIcon, LockIcon, SearchIcon } from "@/components/ui/icons";
import { cx } from "@/lib/cx";

import type { RoomSummaryView, UserRef, WorkspaceRef } from "./types";

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
  onCreateRoom?: () => void;
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
  onCreateRoom,
}: SidebarProps) {
  const channels = rooms.filter((room) => room.kind !== "dm");
  const dms = rooms.filter((room) => room.kind === "dm");

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
        <Avatar id={currentUser.id} name={currentUser.name} size="sm" />
        {switcherOpen && switcher}
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

      {rooms.length === 0 ? (
        <div className="flex flex-col items-center gap-1 px-4 pt-12 text-center">
          <p className="text-base font-medium text-text">まだチャンネルがありません</p>
          <p className="text-xs text-text-muted">誰かを招待して会話を始めましょう</p>
          <Button onClick={onCreateRoom} className="mt-4">
            チャンネルを作成
          </Button>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto pb-4">
          {channels.length > 0 && (
            <RoomSection title="チャンネル" first>
              {channels.map((room) => (
                <RoomRow key={room.id} room={room} href={roomHref(room.id)} selected={room.id === selectedRoomId} />
              ))}
            </RoomSection>
          )}
          {dms.length > 0 && (
            <RoomSection title="ダイレクトメッセージ" first={channels.length === 0}>
              {dms.map((room) => (
                <RoomRow key={room.id} room={room} href={roomHref(room.id)} selected={room.id === selectedRoomId} />
              ))}
            </RoomSection>
          )}
        </div>
      )}
    </nav>
  );
}

function RoomSection({ title, first, children }: { title: string; first: boolean; children: ReactNode }) {
  return (
    <section className={first ? "pt-4" : "pt-3"}>
      <h2 className="px-4 pb-2 text-2xs font-medium text-text-secondary">{title}</h2>
      <ul>{children}</ul>
    </section>
  );
}

function RoomRow({ room, href, selected }: { room: RoomSummaryView; href: string; selected: boolean }) {
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
          <Avatar id={room.peer?.id ?? room.id} name={room.name} size="md" online={room.peer?.online} />
        ) : (
          <span className="flex w-4 shrink-0 justify-center self-start pt-1 text-text-secondary">
            {room.kind === "public" ? (
              <HashIcon aria-label="公開" aria-hidden={false} role="img" className="size-4" />
            ) : (
              <LockIcon aria-label="非公開" aria-hidden={false} role="img" className="size-3.5" />
            )}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate text-base font-semibold text-text">{room.name}</span>
            {room.timeLabel && <span className="shrink-0 font-mono text-2xs text-text-muted">{room.timeLabel}</span>}
          </span>
          <span className="flex items-center justify-between gap-2">
            <span className="truncate text-xs text-text-muted">{room.lastMessage}</span>
            <UnreadBadge count={room.unreadCount} />
          </span>
        </span>
      </Link>
    </li>
  );
}
