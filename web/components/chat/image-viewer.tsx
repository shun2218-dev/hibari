"use client";

import { type KeyboardEvent, useEffect, useEffectEvent, useRef } from "react";

import { IconButton } from "@/components/ui/button";
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon, DownloadIcon, TrashIcon } from "@/components/ui/icons";
import { Portal } from "@/components/ui/portal";
import { cx } from "@/lib/cx";

/** 拡大表示に並べる画像 1 枚ぶん。並びは、そのメッセージの添付の順のまま（ADR 0045 決定 2）。 */
export type ViewerImage = { id: string; fileName: string; url?: string };

type ImageViewerProps = {
  /** 送る範囲は、開いた画像と同じメッセージのインライン表示の画像だけ（ADR 0045 決定 2）。 */
  images: ViewerImage[];
  /** いま出している画像の位置。端では矢印を押せなくする（巻き戻さない。ADR 0045 決定 3）。 */
  index: number;
  onMove: (index: number) => void;
  onClose: () => void;
  /** 既存の仕組みのまま、押すたびに GET URL を取って `<a>` を押させる（ADR 0028）。 */
  onDownload?: (attachmentId: string) => void;
  /** 消せる人のときだけ渡す（ADR 0045 決定 9）。押すと確認のダイアログを出すのは呼ぶ側。 */
  onDelete?: (attachmentId: string) => void;
  /** 署名付き URL が切れていた（ADR 0028 と同じ規則で取り直すのは呼ぶ側）。 */
  onImageError?: (attachmentId: string, url: string) => void;
};

/** Tab でたどれる要素。フォーカスを拡大表示の中に閉じ込めるために集める（ADR 0045 決定 3）。 */
const FOCUSABLE = "button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])";

/**
 * 画像の拡大表示（ADR 0045）。
 *
 * `Portal` で body の直下に出す。`ChatLayout` が横のスライドに `translate` を使っていて、
 * その中に置くと `fixed` の基準がずれるため（components/ui/portal.tsx）。
 *
 * 出すのは原寸の画像そのもの。拡大用の別サイズは作らない（ADR 0045 決定 4）ので、
 * タイムラインに出ている画像を開くぶんには、同じ URL のまま待たずに出る。
 */
export function ImageViewer({ images, index, onMove, onClose, onDownload, onDelete, onImageError }: ImageViewerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const image = images[index];
  const hasPrevious = index > 0;
  const hasNext = index < images.length - 1;

  // 開いたら中にフォーカスを移し、閉じたら元の画像に戻す（ADR 0045 決定 3。Dialog と同じ形）
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();
    return () => previous?.focus();
  }, []);

  // キーは画面ぜんぶで受ける。端まで送ると矢印のボタンが押せなくなってフォーカスが外れるので、
  // 中の要素からの伝わり（onKeyDown）だけに頼ると、そこでキーでの操作が止まってしまう
  const handleKey = useEffectEvent((e: globalThis.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
    if (e.key === "ArrowLeft" && hasPrevious) onMove(index - 1);
    if (e.key === "ArrowRight" && hasNext) onMove(index + 1);
  });
  useEffect(() => {
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, []);

  if (!image) return null;

  return (
    <Portal>
      <div
        // 削除の確認のダイアログ（z-50）を上に出せるよう、ここは 1 段低くする。
        // body の直下に出しているので、z-index を明示しないとダイアログより後ろに描かれても前に出てしまう
        className="fixed inset-0 z-40 flex items-center justify-center bg-overlay md:p-8"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label={`${image.fileName} の拡大表示`}
          tabIndex={-1}
          onKeyDown={(e) => {
            if (e.key === "Tab") trapFocus(e, panelRef.current);
          }}
          // モバイルは全画面（ADR 0045 決定 3）。md 以上は大きなダイアログとして浮かせ、後ろのチャットを残す
          className="flex size-full flex-col overflow-hidden bg-surface focus-visible:outline-none md:size-auto md:h-160 md:w-240 md:max-h-full md:max-w-full md:rounded-lg md:border md:border-border md:shadow-overlay"
        >
          <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3 md:px-4">
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-medium text-text">{image.fileName}</p>
              {images.length > 1 && (
                <p className="font-mono text-2xs text-text-muted">
                  {index + 1} / {images.length}
                </p>
              )}
            </div>
            <IconButton label="ダウンロード" onClick={() => onDownload?.(image.id)}>
              <DownloadIcon className="size-4.5" />
            </IconButton>
            {onDelete && (
              <IconButton
                label="ファイルを削除"
                onClick={() => onDelete(image.id)}
                className="text-danger hover:bg-danger-subtle"
              >
                <TrashIcon className="size-4.5" />
              </IconButton>
            )}
            <IconButton label="閉じる" onClick={onClose}>
              <CloseIcon className="size-4.5" />
            </IconButton>
          </header>

          <div className="relative flex min-h-0 flex-1 items-center justify-center bg-surface-muted p-2 md:p-4">
            {image.url ? (
              // 署名付き URL は短時間で失効し、next/image の最適化も使えないので img を使う（ADR 0028）
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={image.url}
                alt={image.fileName}
                onError={() => onImageError?.(image.id, image.url!)}
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              <span className="font-mono text-2xs text-text-muted">{image.fileName}</span>
            )}

            {/* 1 枚しかなければ、送る導線を出さない（ADR 0045 決定 2） */}
            {images.length > 1 && (
              <>
                <ArrowButton side="left" disabled={!hasPrevious} onClick={() => onMove(index - 1)} />
                <ArrowButton side="right" disabled={!hasNext} onClick={() => onMove(index + 1)} />
              </>
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
}

/** 左右の矢印。端では押せなくする（巻き戻さない。ADR 0045 決定 3）。 */
function ArrowButton({ side, disabled, onClick }: { side: "left" | "right"; disabled: boolean; onClick: () => void }) {
  const Icon = side === "left" ? ChevronLeftIcon : ChevronRightIcon;
  return (
    <IconButton
      label={side === "left" ? "前の画像" : "次の画像"}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "absolute size-10 rounded-full border border-border bg-surface shadow-overlay",
        side === "left" ? "left-2 md:left-4" : "right-2 md:right-4",
      )}
    >
      <Icon className="size-5" />
    </IconButton>
  );
}

/** Tab を端で折り返して、フォーカスを拡大表示の中に閉じ込める。 */
function trapFocus(e: KeyboardEvent, panel: HTMLElement | null) {
  const targets = Array.from(panel?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
  if (targets.length === 0) return;
  const first = targets[0];
  const last = targets[targets.length - 1];
  const active = document.activeElement;
  if (e.shiftKey && (active === first || active === panel)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}
