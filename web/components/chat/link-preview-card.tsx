"use client";

import { IconButton } from "@/components/ui/button";
import { CloseIcon } from "@/components/ui/icons";
import { Spinner } from "@/components/ui/spinner";
import { cx } from "@/lib/cx";

import type { ComposerLinkPreviewView, LinkPreviewView } from "./types";

/**
 * 本文に貼られた外部のリンクのプレビュー（ADR 0065）。
 *
 * 形は Slack のカードに合わせる（オーナーが示した Slack の画面。ADR 0065 の背景）:
 * 左にタイトル・説明・サイトのアイコンと名前、右に画像のサムネイル。
 *
 * 消せるのは投稿した本人だけなので、`onRemove` は本人のメッセージのときだけ渡す。
 * 確認のダイアログは出さず、押したらすぐ消す（ADR 0065 決定 5）。誤って押しにくいように、「x」はホバーかフォーカスのときだけ出す。
 */
export function LinkPreviewCard({
  preview,
  onRemove,
  forceRemoveVisible = false,
}: {
  preview: LinkPreviewView;
  onRemove?: (previewId: string) => void;
  /** 「x」を出した状態で描く（story で状態を再現するため）。 */
  forceRemoveVisible?: boolean;
}) {
  const heading = preview.title ?? preview.siteName;

  return (
    <article
      aria-label={`${heading} のプレビュー`}
      className="group/preview relative flex w-150 max-w-full rounded-md border border-border bg-surface"
    >
      <div className="min-w-0 flex-1 px-3.5 py-2.5">
        {/* 本文に書かれた URL へ飛ぶ（リダイレクトの後の URL ではない。ADR 0065 決定 6）。
            Slack と同じく、タイトルは本文の色の太字にする。リンクであることは下線で示す */}
        <a
          href={preview.url}
          target="_blank"
          rel="noopener noreferrer"
          className="line-clamp-2 text-base leading-tight font-semibold break-words text-text hover:underline"
        >
          {heading}
        </a>
        {preview.description && (
          <p className="mt-1 line-clamp-2 text-sm leading-normal break-words text-text-secondary">{preview.description}</p>
        )}
        <SiteLine siteName={preview.siteName} hasIcon={preview.hasIcon} iconUrl={preview.iconUrl} className="mt-2" />
      </div>

      {preview.image && (
        // サムネイルはカードの高さに合わせて切り取る（Slack と同じ）。URL が取れるまでは枠だけ出し、読み込みでカードの高さを変えない
        <div className="w-20 shrink-0 overflow-hidden rounded-r-md border-l border-border bg-surface-muted md:w-30">
          {preview.image.url && (
            // 署名付き URL は短時間で失効し、next/image の最適化（サーバー経由の取得）も使えないので img を使う（添付と同じ）
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview.image.url} alt="" loading="lazy" className="size-full object-cover" />
          )}
        </div>
      )}

      {onRemove && (
        // Slack と同じく、カードの左の外側（アバターの列との間）に出す。カードの中に置くとタイトルの先頭の文字に重なる。
        // 目立たせない（オーナーの要望）: 枠も地の色も付けず、小さなアイコンだけにし、ホバーで色を濃くする。
        // IconButton は大きさ（size-8）とホバーの地の色を持っていて、cx では上書きできないので、素の button で書く
        <button
          type="button"
          aria-label="プレビューを削除"
          title="プレビューを削除"
          onClick={() => onRemove(preview.id)}
          className={cx(
            "absolute top-2 -left-6 size-5 items-center justify-center rounded-sm text-text-muted hover:text-text",
            forceRemoveVisible ? "flex" : "hidden group-focus-within/preview:flex group-hover/preview:flex",
          )}
        >
          <CloseIcon className="size-3" />
        </button>
      )}
    </article>
  );
}

/**
 * 入力欄のリンクのプレビュー（ADR 0065 決定 13）。本文の下に小さく出す（Slack の入力欄と同じ形）。
 * 「x」で消すと、そのカードは付かずに送られる。
 */
export function ComposerLinkPreview({
  preview,
  onRemove,
}: {
  preview: ComposerLinkPreviewView;
  onRemove?: (url: string) => void;
}) {
  return (
    <div className="flex w-70 max-w-full items-start gap-1 rounded-md border border-border bg-surface py-2 pr-1 pl-3">
      <div className="min-w-0 flex-1">
        {preview.state === "loading" ? (
          <>
            <p className="flex items-center gap-1.5 text-sm text-text-muted">
              <Spinner className="size-3" />
              <span className="truncate">{hostOf(preview.url)}</span>
            </p>
            {/* 取れたときの 2 行目（タイトル）の高さを先に取っておき、取れたときに入力欄の高さを変えない */}
            <span aria-hidden className="mt-1.5 mb-0.5 block h-3.5 w-40 rounded-full bg-surface-muted" />
          </>
        ) : (
          <>
            <SiteLine siteName={preview.siteName} hasIcon={preview.iconUrl !== undefined} iconUrl={preview.iconUrl} strong />
            {preview.title && (
              <a
                href={preview.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-0.5 block truncate text-sm font-medium text-primary hover:underline"
              >
                {preview.title}
              </a>
            )}
          </>
        )}
      </div>
      <IconButton label="プレビューを削除" title="プレビューを削除" onClick={() => onRemove?.(preview.url)} className="size-7">
        <CloseIcon className="size-3.5" />
      </IconButton>
    </div>
  );
}

function SiteLine({
  siteName,
  hasIcon,
  iconUrl,
  strong = false,
  className,
}: {
  siteName: string;
  hasIcon: boolean;
  iconUrl?: string;
  /** 入力欄ではサイト名が見出しになるので太くする（Slack と同じ）。 */
  strong?: boolean;
  className?: string;
}) {
  return (
    <p className={cx("flex items-center gap-1.5", strong ? "text-sm font-semibold text-text" : "text-xs text-text-muted", className)}>
      {hasIcon &&
        (iconUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={iconUrl} alt="" className="size-4 shrink-0 object-contain" />
        ) : (
          // URL が取れるまでは同じ大きさの枠を置き、サイト名が横にずれないようにする
          <span aria-hidden className="size-4 shrink-0 rounded-full bg-surface-muted" />
        ))}
      <span className="truncate">{siteName}</span>
    </p>
  );
}

/** 取得中に出すホスト名。URL として読めなければ書かれたまま出す。 */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
