"use client";

import { useState } from "react";

import { HashIcon, SearchIcon } from "@/components/ui/icons";
import { useDismiss } from "@/hooks/use-dismiss";
import { cx } from "@/lib/cx";

/**
 * 帯の検索欄を押したときに、その場で開くパネル（ADR 0061。Slack の実物と同じ形）。
 *
 * 出すのは候補の行までにする（オーナーの判断。2026-09-23）。Slack は打つたびに一致したメッセージの
 * プレビューも出すが、入力ごとの検索（debounce と前の要求の中断）が要るので、6.16 では作らない。
 *
 * 候補は 2 つだけ。
 *   - 「〜 の検索結果を表示する」（Enter と同じ。何を打ったかを読み返せるように、語をそのまま見せる）
 *   - 「#〜 で検索する」（いま開いているチャンネルに絞る近道。`in:#〜` を足すのと同じ）
 */
export function SearchPanel({
  value,
  workspaceName,
  roomName,
  onChange,
  onSubmit,
  onSearchInRoom,
  onClose,
  activeSuggestion = "all",
}: {
  value: string;
  /** 空のときの文言に出す（「〜 内を検索する」）。 */
  workspaceName: string;
  /** いま開いているチャンネルの名前。開いていなければ渡さない（その候補を出さない）。 */
  roomName?: string;
  onChange?: (value: string) => void;
  onSubmit?: () => void;
  onSearchInRoom?: () => void;
  onClose?: () => void;
  /** どの候補を選んでいるか（↑↓ で動かす。story で状態を再現するためにも使う）。 */
  activeSuggestion?: "all" | "room";
}) {
  const typed = value.trim().length > 0;
  // 外を押す・Esc で閉じる（アプリで共通の振る舞い）
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  useDismiss(panel, onClose);
  return (
    <div
      ref={setPanel}
      className="absolute inset-x-0 top-0 z-30 overflow-hidden rounded-sm border border-border bg-surface shadow-overlay"
    >
      <label className="flex h-8.5 items-center gap-2 px-2.5">
        <SearchIcon className="size-4 shrink-0 text-text-secondary" />
        <input
          type="text"
          autoFocus
          aria-label="メッセージを検索"
          placeholder={`${workspaceName} 内を検索する`}
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          // Esc はここで拾わない（useDismiss が外を押すのと一緒に面倒を見る。二重に呼ばないため）
          onKeyDown={(e) => {
            if (e.key === "Enter") onSubmit?.();
          }}
          className="min-w-0 flex-1 bg-transparent text-sm text-text placeholder:text-text-muted focus-visible:outline-none"
        />
      </label>

      <div className="border-t border-border py-1">
        {typed && (
          <Suggestion active={activeSuggestion === "all"} onClick={onSubmit}>
            <SearchIcon className="size-4 shrink-0 text-text-secondary" />
            <span className="min-w-0 flex-1 truncate">
              <span className="font-semibold text-text">{value}</span> の検索結果を表示する
            </span>
            <kbd className="shrink-0 rounded-sm border border-border px-1.5 py-0.5 font-mono text-2xs text-text-muted">
              Enter
            </kbd>
          </Suggestion>
        )}
        {roomName !== undefined && (
          <Suggestion active={typed && activeSuggestion === "room"} onClick={onSearchInRoom}>
            <HashIcon className="size-4 shrink-0 text-text-secondary" />
            <span className="min-w-0 flex-1 truncate">
              <span className="font-semibold text-text">{roomName}</span> で検索する
            </span>
          </Suggestion>
        )}
        {!typed && roomName === undefined && (
          <p className="px-2.5 py-2 text-xs text-text-muted">探したい言葉を入力してください</p>
        )}
      </div>
    </div>
  );
}

function Suggestion({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm text-text-secondary",
        active ? "bg-surface-muted" : "hover:bg-surface-muted",
        "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary",
      )}
    >
      {children}
    </button>
  );
}
