"use client";

import type { ReactNode } from "react";

import { ArrowLeftIcon, ArrowRightIcon, CloseIcon, SearchIcon } from "@/components/ui/icons";
import { cx } from "@/lib/cx";

/**
 * 画面のいちばん上の帯（ADR 0061 決定 9。Slack と同じ置き場所）。
 *
 * 左に「戻る・進む」、真ん中に検索欄を置く。rail もサイドバーもこの帯の下から始まる。
 * ワークスペースの切り替えと自分のアバターは、いままでどおり rail の上下に残す（オーナーの判断。2026-09-23）。
 *
 * 検索欄は入力欄ではなくボタンにする。押すと `panel`（候補つきの本物の入力欄）が同じ位置に重なって開く。
 * 帯に常に入力欄を置くと、開いていないときもフォーカスを奪え、Esc で閉じる先がなくなるため。
 */
export function TopBar({
  workspaceName,
  query,
  onOpenSearch,
  onClearQuery,
  onBack,
  onForward,
  canGoBack = false,
  canGoForward = false,
  panel,
}: {
  /** 検索欄の文言に出すワークスペースの名前（「〜 内を検索する」）。 */
  workspaceName: string;
  /** 検索中のときの語。渡すと検索欄が「検索：〜」になり、× で消せる。 */
  query?: string;
  onOpenSearch?: () => void;
  onClearQuery?: () => void;
  onBack?: () => void;
  onForward?: () => void;
  canGoBack?: boolean;
  canGoForward?: boolean;
  /** 開いている検索のパネル。渡すと検索欄の代わりに描く。 */
  panel?: ReactNode;
}) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-surface-muted px-2">
      {/*
        左右に同じだけ伸びる余白を置いて、検索欄を画面の真ん中に保つ。
        矢印は左の余白の中で**右寄せ**にして、検索欄のすぐ左に付ける（Slack の実物と同じ。オーナーの指摘。2026-09-24）。
        画面の左端に置くと、検索欄との間が大きく空いて、何の矢印なのか分からなくなる。
      */}
      <div className="flex min-w-0 flex-1 justify-end gap-1">
        <NavButton label="戻る" onClick={onBack} disabled={!canGoBack}>
          <ArrowLeftIcon className="size-4" />
        </NavButton>
        <NavButton label="進む" onClick={onForward} disabled={!canGoForward}>
          <ArrowRightIcon className="size-4" />
        </NavButton>
      </div>

      {/* 幅は 640px まで。狭い画面では縮む（両側の余白は basis が 0 なので、先にこちらが縮む） */}
      <div className="w-160 max-w-full min-w-0">
        <div className="relative">
          {panel ?? (
            <div className="relative">
              <button
                type="button"
                onClick={onOpenSearch}
                className={cx(
                  "flex h-8.5 w-full items-center gap-2 rounded-sm border border-border bg-surface pl-2.5 text-left",
                  "hover:bg-surface-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary",
                  // × のぶんだけ右を空ける（× は入れ子にできないので、隣に重ねて置く）
                  query === undefined ? "pr-2.5" : "pr-9",
                )}
              >
                <SearchIcon className="size-4 shrink-0 text-text-secondary" />
                {query === undefined ? (
                  <span className="truncate text-sm text-text-muted">{workspaceName} 内を検索する</span>
                ) : (
                  <span className="truncate text-sm text-text">検索：{query}</span>
                )}
              </button>
              {query !== undefined && (
                <button
                  type="button"
                  aria-label="検索をやめる"
                  onClick={onClearQuery}
                  className="absolute inset-y-0 right-1 my-auto flex size-6.5 items-center justify-center rounded-sm text-text-secondary hover:bg-surface-muted hover:text-text focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
                >
                  <CloseIcon className="size-4" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 左と同じだけ伸びる余白。これで検索欄が画面の中央に来る */}
      <div className="min-w-0 flex-1" aria-hidden />
    </div>
  );
}

function NavButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={cx(
        // モバイルは幅が足りないので出さない（ブラウザの戻るで代用できる）
        "hidden size-8 shrink-0 items-center justify-center rounded-sm md:flex",
        disabled ? "text-text-muted" : "text-text-secondary hover:bg-surface hover:text-text",
        "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary",
      )}
    >
      {children}
    </button>
  );
}
