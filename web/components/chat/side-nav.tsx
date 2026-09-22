"use client";

import Link from "next/link";
import { type ComponentType, type ReactNode, useEffect, useRef, useState } from "react";

import { UnreadBadge } from "@/components/ui/badge";
import { BellIcon, BookmarkIcon, DmIcon, HomeIcon } from "@/components/ui/icons";
import { cx } from "@/lib/cx";

/** 左のメニューの項目（ADR 0058 決定 1）。URL のクエリ `side` の値と同じ（ホームは付けない）。 */
export type SideNavKey = "home" | "dms" | "activity" | "later";

export type SideNavItems = Record<
  SideNavKey,
  {
    href: string;
    /**
     * 知らせが要るものの数（琥珀のバッジ）。DM は未読の会話の数、アクティビティは未読の件数。
     * ホームと「後で」には渡さない（ホームの未読は中の太字で分かり、「後で」は未読ではない）。
     */
    badge?: number;
  }
>;

const ITEMS: readonly { key: SideNavKey; label: string; icon: ComponentType<{ className?: string }> }[] = [
  { key: "home", label: "ホーム", icon: HomeIcon },
  { key: "dms", label: "DM", icon: DmIcon },
  { key: "activity", label: "アクティビティ", icon: BellIcon },
  { key: "later", label: "後で", icon: BookmarkIcon },
];

type SideNavProps = {
  items: SideNavItems;
  current: SideNavKey;
};

/** ポインタを乗せてから一覧を出すまで・外してから閉じるまでの間（メニューとパネルの間を動かしたときに閉じないように）。 */
const OPEN_DELAY_MS = 150;
const CLOSE_DELAY_MS = 200;

/**
 * md 以上でサイドバーの左に置く縦のメニュー（Slack と同じく、アイコンの下に文字）。
 * 押すとサイドバーの中身が切り替わる。上にワークスペース、下に自分のアバターを置く（どのメニューを開いていても届くように）。
 *
 * ポインタを乗せると、そのメニューの一覧をサイドバーの上に重ねて出す（ADR 0058 の追記。Slack と同じ）。
 * 今いるメニューと、`previews` に中身を渡さないメニュー（ホーム）では出さない。ポインタの操作だけの近道なので、
 * キーボードのフォーカスでは出さない（押せばサイドバーが同じ一覧に切り替わる）。
 */
export function SideNavRail({
  items,
  current,
  workspace,
  account,
  previews = {},
  openPreview,
}: SideNavProps & {
  /** 上のワークスペースのボタン（切り替えのポップオーバーを含む）。 */
  workspace: ReactNode;
  /** 下の自分のアバターのボタン（アカウントのメニューを含む）。 */
  account: ReactNode;
  /** ポインタを乗せたときに重ねて出す一覧（DM・アクティビティ・後での preview の形）。 */
  previews?: Partial<Record<SideNavKey, ReactNode>>;
  /** 重ねた一覧を開いたまま描く（story で状態を再現するため）。 */
  openPreview?: SideNavKey;
}) {
  const [hovered, setHovered] = useState<SideNavKey | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  function schedule(next: SideNavKey | null) {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setHovered(next), next === null ? CLOSE_DELAY_MS : OPEN_DELAY_MS);
  }

  const shown = openPreview ?? hovered;
  const preview = shown !== null && shown !== current ? previews[shown] : undefined;

  return (
    <nav
      aria-label="メニュー"
      onMouseLeave={() => schedule(null)}
      className="relative flex h-full w-18 shrink-0 flex-col items-center gap-4 border-r border-border bg-surface-muted py-3"
    >
      <div className="relative">{workspace}</div>
      <ul className="flex flex-1 flex-col items-center gap-3">
        {ITEMS.map((item) => (
          <li key={item.key} onMouseEnter={() => schedule(item.key)}>
            <RailItem
              {...item}
              href={items[item.key].href}
              badge={items[item.key].badge}
              selected={item.key === current}
              previewing={item.key === shown && preview !== undefined}
              onNavigate={() => {
                clearTimeout(timer.current);
                setHovered(null);
              }}
            />
          </li>
        ))}
      </ul>
      <div className="relative">{account}</div>
      {preview !== undefined && (
        // パネルの上ではポインタが外れても閉じない（nav の中なので mouseleave は nav を出たときだけ）。
        // 一覧の 1 件を押したらルームを開くので、閉じる
        <div
          onMouseEnter={() => clearTimeout(timer.current)}
          onClick={() => setHovered(null)}
          className="absolute top-2 bottom-2 left-full z-30 ml-1 w-96 overflow-hidden rounded-lg border border-border bg-surface shadow-overlay"
        >
          {preview}
        </div>
      )}
    </nav>
  );
}

function RailItem({
  label,
  icon: Icon,
  href,
  badge = 0,
  selected,
  previewing,
  onNavigate,
}: {
  label: string;
  icon: ComponentType<{ className?: string }>;
  href: string;
  badge?: number;
  selected: boolean;
  /** このメニューの一覧を重ねて出している。 */
  previewing: boolean;
  onNavigate: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={selected ? "page" : undefined}
      className="group flex w-18 flex-col items-center gap-1"
    >
      <span
        className={cx(
          "relative flex size-9 items-center justify-center rounded-md",
          // 今いるメニューは地の色で示す。押せるものなので緑（docs/ui/tokens.md）
          selected ? "bg-primary-subtle text-primary" : previewing ? "bg-surface text-text" : "text-text-secondary group-hover:bg-surface",
        )}
      >
        <Icon className="size-5" />
        <UnreadBadge count={badge} className="absolute -top-1.5 -right-2.5" />
      </span>
      {/* Slack と同じく 4 文字で折り返す（「アクティ / ビティ」）。text-2xs（11px）の 4 文字ぶんが w-11（44px） */}
      <span className={cx("w-11 text-center text-2xs leading-tight", selected ? "font-semibold text-text" : "text-text-secondary")}>
        {label}
      </span>
    </Link>
  );
}

/**
 * モバイル（768px 未満）で一覧の下に置くタブ（ADR 0058 決定 1）。ルームを開いている間は一覧ごと隠れるので、このタブも出ない。
 * ワークスペースと自分のアバターは、ホームのサイドバーの上にある（いままでどおり）。
 */
export function SideNavBar({ items, current }: SideNavProps) {
  return (
    <nav aria-label="メニュー" className="shrink-0 border-t border-border bg-surface">
      <ul className="grid grid-cols-4">
        {ITEMS.map((item) => {
          const selected = item.key === current;
          const badge = items[item.key].badge ?? 0;
          return (
            <li key={item.key}>
              <Link
                href={items[item.key].href}
                aria-current={selected ? "page" : undefined}
                className={cx("flex h-14 flex-col items-center justify-center gap-1", selected ? "text-primary" : "text-text-secondary")}
              >
                <span className="relative">
                  <item.icon className="size-5" />
                  <UnreadBadge count={badge} className="absolute -top-1.5 -right-3" />
                </span>
                <span className={cx("text-2xs", selected && "font-semibold")}>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
