import { Avatar } from "@/components/ui/avatar";
import { Button, IconButton, TextButton } from "@/components/ui/button";
import { ChevronRightIcon, ClockIcon, FileIcon, MoreIcon, ReplyIcon, ThreadIcon } from "@/components/ui/icons";
import { Popover } from "@/components/ui/popover";
import { cx } from "@/lib/cx";

import { MessageLinkCard } from "./message-link-card";
import type { MessageAttachmentView, MessageView } from "./types";

/** 編集中の本文。null（既定）なら編集していない。編集できるのは自分のメッセージだけ（ADR 0012）。 */
export type MessageEditingView = {
  value: string;
  onChange?: (value: string) => void;
  onSave?: () => void;
  onCancel?: () => void;
  saving?: boolean;
};

type MessageItemProps = {
  message: MessageView;
  onRetry?: () => void;
  onDiscard?: () => void;
  onReply?: () => void;
  /** 「返信」を出すか。スレッドの中（親と返信）では出さない（スレッドは入れ子にしない。ADR 0036）。 */
  canReply?: boolean;
  /**
   * 「N 件の返信」を押した（スレッドのパネルを開く。ADR 0036）。
   * チャンネルに流した返信の「スレッドに返信しました」でも呼ぶ（ADR 0039）。どの親を開くかは呼ぶ側が key から引く。
   */
  onOpenThread?: () => void;
  /** スレッドのパネルで開いている親。選択中のチャンネルと同じ色で示す。 */
  threadOpen?: boolean;
  onDownload?: (attachmentId: string) => void;
  /** 画像が読み込めなかった（署名付き URL の期限切れなど）。url は読み込みに使った URL。 */
  onImageError?: (attachmentId: string, url: string) => void;
  /** 「…」で出せる操作。どれも無ければ「…」自体を出さない。 */
  canEdit?: boolean;
  canDelete?: boolean;
  /**
   * 「リンクをコピー」（ADR 0040）。読めている人なら誰でもコピーできるので、権限では出し分けない。
   * まだ ID のない送信中のメッセージには渡さない（パーマリンクを作れない）。
   * label は「リンクをコピー」/「コピーしました」/「コピーできませんでした」を呼ぶ側が決める。
   */
  copyLink?: { label: string; onClick: () => void };
  menuOpen?: boolean;
  onToggleMenu?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  editing?: MessageEditingView | null;
  /** ホバーしたときの見た目を固定で出す（/dev/preview で状態を再現するため）。 */
  forceHover?: boolean;
};

export function MessageItem({
  message,
  onRetry,
  onDiscard,
  onReply,
  canReply = true,
  onOpenThread,
  threadOpen = false,
  onDownload,
  onImageError,
  canEdit = false,
  canDelete = false,
  copyLink,
  menuOpen = false,
  onToggleMenu,
  onEdit,
  onDelete,
  editing = null,
  forceHover,
}: MessageItemProps) {
  const { sender, status, deleted } = message;
  // 削除済みには操作の対象がなく、送信失敗には専用の操作（再送・削除）があるので、ホバーの操作を出さない
  const hasMenu = canEdit || canDelete || copyLink !== undefined;
  const actionable = status !== "failed" && !deleted && editing === null && (canReply || hasMenu);

  return (
    <article
      aria-label={`${sender.name} ${message.timeLabel}`}
      className={cx(
        "group relative flex gap-2.5 px-3 md:gap-3 md:px-4",
        message.grouped ? "py-1" : "pt-3 pb-1",
        threadOpen
          ? "bg-primary-subtle"
          : forceHover
            ? "bg-surface-muted"
            : "hover:bg-surface-muted focus-within:bg-surface-muted",
      )}
    >
      {status === "failed" && <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-danger" />}

      {message.grouped ? (
        <span aria-hidden className="w-8 shrink-0 md:w-10" />
      ) : (
        <Avatar id={sender.id} name={sender.name} imageUrl={sender.avatarUrl} size="message" className="mt-0.5" />
      )}

      <div className="min-w-0 flex-1">
        {!message.grouped && (
          <header className="flex items-baseline gap-2">
            <span className="text-sm font-semibold text-text">{sender.name}</span>
            <time className="font-mono text-2xs text-text-muted">{message.timeLabel}</time>
          </header>
        )}

        {message.broadcast?.in === "channel" && !deleted && (
          <button
            type="button"
            onClick={onOpenThread}
            className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
          >
            <ThreadIcon className="size-3.5" />
            スレッドに返信しました
          </button>
        )}

        {editing ? (
          <MessageEditor editing={editing} />
        ) : deleted ? (
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

        {!deleted && !editing && message.attachments.length > 0 && (
          <ul className="mt-2 flex flex-col gap-2">
            {message.attachments.map((attachment) => (
              <li key={attachment.id}>
                <Attachment attachment={attachment} onDownload={onDownload} onImageError={onImageError} />
              </li>
            ))}
          </ul>
        )}

        {/* 本文に貼られたパーマリンクのカード（ADR 0040）。本文の下に並べる。
            本文中の URL 自体をリンクにするのは Phase 6.10（本文の書式）の仕事なので、ここではしない。 */}
        {!deleted && !editing && message.linkCards && message.linkCards.length > 0 && (
          <ul className="mt-2 flex flex-col gap-2">
            {message.linkCards.map((card) => (
              <li key={card.key}>
                <MessageLinkCard card={card} />
              </li>
            ))}
          </ul>
        )}

        {message.broadcast?.in === "thread" && !deleted && !editing && (
          <p className="pt-0.5 text-2xs text-text-muted">{message.broadcast.label}</p>
        )}

        {message.thread && !editing && (
          <ThreadSummary thread={message.thread} onOpen={onOpenThread} />
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
          {canReply && (
            <IconButton label="返信" onClick={onReply} className="size-7">
              <ReplyIcon className="size-4" />
            </IconButton>
          )}
          {hasMenu && (
            <IconButton
              label="その他の操作"
              aria-expanded={menuOpen}
              onClick={onToggleMenu}
              className={cx("size-7", menuOpen && "bg-surface-muted")}
            >
              <MoreIcon className="size-4" />
            </IconButton>
          )}
        </div>
      )}

      {menuOpen && hasMenu && (
        <Popover label="メッセージの操作" className="top-6 right-4 w-52">
          {copyLink && (
            <button
              type="button"
              onClick={copyLink.onClick}
              className="flex h-9.5 w-full items-center rounded-sm px-2.5 text-left text-base text-text hover:bg-surface-muted"
            >
              {copyLink.label}
            </button>
          )}
          {canEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="flex h-9.5 w-full items-center rounded-sm px-2.5 text-left text-base text-text hover:bg-surface-muted"
            >
              メッセージを編集
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="flex h-9.5 w-full items-center rounded-sm px-2.5 text-left text-base font-medium text-danger hover:bg-surface-muted"
            >
              メッセージを削除
            </button>
          )}
        </Popover>
      )}
    </article>
  );
}

/**
 * 親のメッセージの下の「N 件の返信」。押すとスレッドを開く（押せるので緑。docs/ui/tokens.md）。
 * 親が削除されていても、返信は残るので出す（ADR 0036）。
 */
function ThreadSummary({ thread, onOpen }: { thread: NonNullable<MessageView["thread"]>; onOpen?: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group/thread mt-1.5 -ml-1.5 flex h-7 items-center gap-2 rounded-sm px-1.5 text-xs hover:bg-surface"
    >
      <span className="font-semibold text-primary group-hover/thread:underline">{thread.replyCount} 件の返信</span>
      <span className="font-mono text-2xs text-text-muted">最終返信 {thread.lastReplyLabel}</span>
      <ChevronRightIcon className="size-3.5 text-text-muted" />
    </button>
  );
}

/** 本文をその場で書き換える。Enter で保存、Esc で取りやめ（改行は Shift + Enter）。 */
function MessageEditor({ editing }: { editing: MessageEditingView }) {
  return (
    <div className="flex flex-col gap-1.5 pt-0.5">
      <textarea
        aria-label="メッセージを編集"
        autoFocus
        rows={1}
        value={editing.value}
        onChange={(e) => editing.onChange?.(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") editing.onCancel?.();
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (editing.value.trim() !== "") editing.onSave?.();
          }
        }}
        className="max-h-60 min-h-11 w-full resize-none rounded-md border border-border bg-surface px-3 py-2 text-lg leading-relaxed text-text focus-visible:-outline-offset-2"
      />
      <div className="flex items-center justify-between gap-3">
        <span className="text-2xs text-text-muted">Enter で保存 / Esc でキャンセル</span>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={editing.onCancel}>
            キャンセル
          </Button>
          <Button size="sm" onClick={editing.onSave} disabled={editing.saving || editing.value.trim() === ""}>
            保存
          </Button>
        </div>
      </div>
    </div>
  );
}

function Attachment({
  attachment,
  onDownload,
  onImageError,
}: {
  attachment: MessageAttachmentView;
  onDownload?: (attachmentId: string) => void;
  onImageError?: (attachmentId: string, url: string) => void;
}) {
  if (attachment.kind === "image") {
    // 寸法が分かっていれば先に枠を確保し、画像の読み込みでタイムラインがずれないようにする（ADR 0013）
    const aspectRatio = attachment.width && attachment.height ? `${attachment.width} / ${attachment.height}` : undefined;
    return (
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
