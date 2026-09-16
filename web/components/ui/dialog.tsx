"use client";

import { type ReactNode, useEffect, useId, useRef } from "react";

import { cx } from "@/lib/cx";

type DialogProps = {
  open: boolean;
  title: string;
  description?: ReactNode;
  /** Escape キーと背景のクリックで呼ぶ。渡さなければ閉じられない（確定を待つダイアログ）。 */
  onClose?: () => void;
  children?: ReactNode;
  /** 右寄せで並べるボタン。 */
  actions?: ReactNode;
  /** 既定は 400px。候補のリストを並べるダイアログ（オーナーの譲渡）は wide で 440px にする。 */
  width?: "default" | "wide";
};

/**
 * モーダルダイアログ。
 *
 * 開いたときにパネルへフォーカスを移し、閉じたら元の要素に戻す。背景のスクロールは止めない
 * （チャットの画面は全体が固定の高さで、ページ自体はスクロールしないため）。
 */
export function Dialog({ open, title, description, onClose, children, actions, width = "default" }: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();
    return () => previous?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose?.();
        }}
        className={cx(
          "flex max-h-full w-full flex-col gap-5 rounded-lg border border-border bg-surface p-6 shadow-overlay focus-visible:outline-none",
          width === "wide" ? "max-w-110" : "max-w-100",
        )}
      >
        <div className="flex flex-col gap-2">
          <h2 id={titleId} className="text-xl font-bold text-text">
            {title}
          </h2>
          {description && (
            <div id={descriptionId} className="text-sm leading-relaxed text-text-secondary">
              {description}
            </div>
          )}
        </div>
        {children}
        {actions && <div className="flex justify-end gap-2">{actions}</div>}
      </div>
    </div>
  );
}
