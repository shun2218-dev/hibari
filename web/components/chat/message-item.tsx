import { Avatar } from "@/components/ui/avatar";
import { IconButton, TextButton } from "@/components/ui/button";
import { ClockIcon, FileIcon, MoreIcon, ReplyIcon } from "@/components/ui/icons";
import { cx } from "@/lib/cx";

import type { MessageAttachmentView, MessageView } from "./types";

type MessageItemProps = {
  message: MessageView;
  onRetry?: () => void;
  onDiscard?: () => void;
  onReply?: () => void;
  onMore?: () => void;
  onDownload?: (attachmentId: string) => void;
  /** ホバーしたときの見た目を固定で出す（/dev/preview で状態を再現するため）。 */
  forceHover?: boolean;
};

export function MessageItem({ message, onRetry, onDiscard, onReply, onMore, onDownload, forceHover }: MessageItemProps) {
  const { sender, status, deleted } = message;
  // 削除済みには操作の対象がなく、送信失敗には専用の操作（再送・削除）があるので、ホバーの操作を出さない
  const actionable = status !== "failed" && !deleted;

  return (
    <article
      aria-label={`${sender.name} ${message.timeLabel}`}
      className={cx(
        "group relative flex gap-2.5 px-3 md:gap-3 md:px-4",
        message.grouped ? "py-1" : "pt-3 pb-1",
        forceHover ? "bg-surface-muted" : "hover:bg-surface-muted focus-within:bg-surface-muted",
      )}
    >
      {status === "failed" && <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-danger" />}

      {message.grouped ? (
        <span aria-hidden className="w-8 shrink-0 md:w-10" />
      ) : (
        <Avatar id={sender.id} name={sender.name} size="message" className="mt-0.5" />
      )}

      <div className="min-w-0 flex-1">
        {!message.grouped && (
          <header className="flex items-baseline gap-2">
            <span className="text-sm font-semibold text-text">{sender.name}</span>
            <time className="font-mono text-2xs text-text-muted">{message.timeLabel}</time>
          </header>
        )}

        {message.replyTo && !deleted && (
          <p className="flex min-w-0 items-center gap-1.5 text-2xs text-text-muted">
            <ReplyIcon className="size-3 shrink-0" />
            <span className="shrink-0 font-semibold text-text-secondary">{message.replyTo.senderName}</span>
            <span className="truncate">{message.replyTo.body}</span>
          </p>
        )}

        {deleted ? (
          <p className="text-lg leading-relaxed text-text-muted italic">このメッセージは削除されました</p>
        ) : (
          <div className="flex items-start gap-2">
            <p
              className={cx(
                "min-w-0 flex-1 text-lg leading-relaxed break-words whitespace-pre-wrap",
                status === "pending" ? "text-text-muted" : "text-text",
              )}
            >
              {message.body}
              {message.edited && <span className="ml-1.5 text-2xs text-text-muted">（編集済み）</span>}
            </p>
            {status === "pending" && (
              <span role="img" aria-label="送信中" className="mt-1.5 shrink-0 text-text-muted">
                <ClockIcon className="size-3.5" />
              </span>
            )}
          </div>
        )}

        {!deleted && message.attachments.length > 0 && (
          <ul className="mt-2 flex flex-col gap-2">
            {message.attachments.map((attachment) => (
              <li key={attachment.id}>
                <Attachment attachment={attachment} onDownload={onDownload} />
              </li>
            ))}
          </ul>
        )}

        {status === "failed" && (
          <p className="flex items-center gap-3 pt-0.5 text-xs leading-normal">
            <span role="alert" className="text-danger">
              送信できませんでした
            </span>
            <TextButton onClick={onRetry}>再送する</TextButton>
            <TextButton onClick={onDiscard}>削除</TextButton>
          </p>
        )}
      </div>

      {actionable && (
        <div
          className={cx(
            "absolute -top-3 right-4 items-center rounded-sm border border-border bg-surface p-0.5",
            forceHover ? "flex" : "hidden group-hover:flex group-focus-within:flex",
          )}
        >
          <IconButton label="返信" onClick={onReply} className="size-7">
            <ReplyIcon className="size-4" />
          </IconButton>
          <IconButton label="その他の操作" onClick={onMore} className="size-7">
            <MoreIcon className="size-4" />
          </IconButton>
        </div>
      )}
    </article>
  );
}

function Attachment({
  attachment,
  onDownload,
}: {
  attachment: MessageAttachmentView;
  onDownload?: (attachmentId: string) => void;
}) {
  if (attachment.kind === "image") {
    // 寸法が分かっていれば先に枠を確保し、画像の読み込みでタイムラインがずれないようにする（ADR 0013）
    const aspectRatio = attachment.width && attachment.height ? `${attachment.width} / ${attachment.height}` : undefined;
    return (
      <div
        className="flex w-65 max-w-full items-center justify-center overflow-hidden rounded-md border border-border bg-surface-muted"
        style={{ aspectRatio: aspectRatio ?? "13 / 8" }}
      >
        {attachment.url ? (
          // 署名付き URL は短時間で失効し、next/image の最適化（サーバー経由の取得）も使えないので img を使う
          // eslint-disable-next-line @next/next/no-img-element
          <img src={attachment.url} alt={attachment.fileName} className="size-full object-cover" />
        ) : (
          <span className="font-mono text-2xs text-text-muted">{attachment.fileName}</span>
        )}
      </div>
    );
  }

  return (
    <div className="flex w-90 max-w-full items-center gap-3 rounded-md border border-border bg-surface px-3.5 py-2.5">
      <FileIcon className="size-4.5 shrink-0 text-text-secondary" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-text">{attachment.fileName}</p>
        <p className="font-mono text-2xs text-text-muted">{attachment.sizeLabel}</p>
      </div>
      <TextButton onClick={() => onDownload?.(attachment.id)} className="text-xs font-semibold">
        ダウンロード
      </TextButton>
    </div>
  );
}
