"use client";

import type { MessageAttachmentView } from "@/components/chat/types";
import { IconButton } from "@/components/ui/button";
import { DownloadIcon, FileIcon, MoreIcon, TrashIcon } from "@/components/ui/icons";
import { MenuItem } from "@/components/ui/menu-item";
import { Popover } from "@/components/ui/popover";
import { cx } from "@/lib/cx";

/**
 * 添付の 1 件（ADR 0013）。画像は縮小して出し、ほかはファイルの行にする。
 */
export function Attachment({
  attachment,
  onDownload,
  onImageError,
  onOpen,
  onDelete,
  menuOpen = false,
  onToggleMenu,
}: {
  attachment: MessageAttachmentView;
  onDownload?: (attachmentId: string) => void;
  onImageError?: (attachmentId: string, url: string) => void;
  onOpen?: (attachmentId: string) => void;
  onDelete?: (attachmentId: string) => void;
  menuOpen?: boolean;
  onToggleMenu?: (attachmentId: string) => void;
}) {
  if (attachment.kind === "image") {
    // 寸法が分かっていれば先に枠を確保し、画像の読み込みでタイムラインがずれないようにする（ADR 0013）
    const aspectRatio = attachment.width && attachment.height ? `${attachment.width} / ${attachment.height}` : undefined;
    const frame = (
      <div
        // 縦に長い画像がタイムラインを占めないよう、高さを抑えて切り取る
        className="flex max-h-80 w-65 max-w-full items-center justify-center overflow-hidden rounded-md border border-border bg-surface-muted"
        style={{ aspectRatio: aspectRatio ?? "13 / 8" }}
      >
        {attachment.url ? (
          // 署名付き URL は短時間で失効し、next/image の最適化（サーバー経由の取得）も使えないので img を使う
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={attachment.url}
            alt={attachment.fileName}
            // 画面の外の画像は、見えるまで読み込まない（1 枚で最大 25 MiB。ADR 0013）
            loading="lazy"
            onError={() => onImageError?.(attachment.id, attachment.url!)}
            className="size-full object-cover"
          />
        ) : (
          <span className="font-mono text-2xs text-text-muted">{attachment.fileName}</span>
        )}
      </div>
    );

    // 押して開けるのは、実際に画像が出ているときだけ（送信中の添付はまだ GET URL がない。ADR 0045 決定 1）
    if (!onOpen || !attachment.url) return frame;
    return (
      <button
        type="button"
        aria-label={`${attachment.fileName} を拡大表示`}
        onClick={() => onOpen(attachment.id)}
        // 画像はボタンに見えないので、ポインタで「押すと開く」ことを示す（Tailwind v4 の button は cursor: default）
        className="block cursor-zoom-in rounded-md"
      >
        {frame}
      </button>
    );
  }

  return (
    <div className="relative flex w-90 max-w-full items-center gap-3 rounded-md border border-border bg-surface px-3.5 py-2.5">
      <FileIcon className="size-4.5 shrink-0 text-text-secondary" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-text">{attachment.fileName}</p>
        <p className="font-mono text-2xs text-text-muted">{attachment.sizeLabel}</p>
      </div>
      {/* 拡大表示の中のダウンロードと同じアイコン（ADR 0045）。文字のボタンより行が軽くなる（オーナーの要望、2026-09-21） */}
      <IconButton label="ダウンロード" title="ダウンロード" onClick={() => onDownload?.(attachment.id)} className="size-7">
        <DownloadIcon className="size-4" />
      </IconButton>
      {/* 画像でない添付の削除は、この行の「…」から（画像は拡大表示の中にある。ADR 0045 決定 9） */}
      {onDelete && (
        <IconButton
          label="ファイルの操作"
          aria-expanded={menuOpen}
          onClick={() => onToggleMenu?.(attachment.id)}
          className={cx("size-7", menuOpen && "bg-surface-muted")}
        >
          <MoreIcon className="size-4" />
        </IconButton>
      )}
      {menuOpen && onDelete && (
        <Popover label="ファイルの操作" className="top-11 right-0 w-44" onDismiss={() => onToggleMenu?.(attachment.id)}>
          <MenuItem icon={TrashIcon} onClick={() => onDelete(attachment.id)} danger>
            ファイルを削除
          </MenuItem>
        </Popover>
      )}
    </div>
  );
}
