"use client";

import { type ReactNode, useRef, useState } from "react";

import { AnchoredPanel } from "@/components/ui/anchored-panel";
import { Avatar } from "@/components/ui/avatar";
import { Portal } from "@/components/ui/portal";
import { Button, IconButton, TextButton } from "@/components/ui/button";
import {
  BookmarkIcon,
  ChevronRightIcon,
  ClockIcon,
  DownloadIcon,
  FileIcon,
  LinkIcon,
  MoreIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  ReplyIcon,
  SmilePlusIcon,
  ThreadIcon,
  TrashIcon,
} from "@/components/ui/icons";
import { MenuItem } from "@/components/ui/menu-item";
import { Popover } from "@/components/ui/popover";
import type { MentionCandidate } from "@/lib/chat/mentions";
import { cx } from "@/lib/cx";
import { useHoverIntent } from "@/lib/use-hover-intent";
import { DESKTOP_QUERY, useMediaQuery } from "@/lib/use-media-query";

import { RichTextInput } from "./editor/rich-text-input";
import { MessageBody } from "./message-body";
import { MessageLinkCard } from "./message-link-card";
import { MessageReactions } from "./message-reactions";
import { ProfileHoverPopup } from "./profile-card";
import type { MessageAttachmentView, MessageView } from "./types";
import { StatusEmoji } from "./user-status";

/** 編集中の本文。null（既定）なら編集していない。編集できるのは自分のメッセージだけ（ADR 0012）。 */
export type MessageEditingView = {
  /** 送る形の本文（ADR 0051 の記法。メンションはトークン。ADR 0052 決定 3）。 */
  value: string;
  /** 編集中の `@` の補完の候補（ルームのメンバーと全員宛て）。 */
  mentionCandidates?: readonly MentionCandidate[];
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
  /**
   * リンクや一覧から飛んできた先のメッセージ（ADR 0042）。数秒だけ琥珀の地を敷いて、どれに飛んだかを示す。
   * 消すのは呼ぶ側（時間か、押したとき）。
   */
  highlighted?: boolean;
  onDownload?: (attachmentId: string) => void;
  /** 画像が読み込めなかった（署名付き URL の期限切れなど）。url は読み込みに使った URL。 */
  onImageError?: (attachmentId: string, url: string) => void;
  /**
   * インライン表示している画像を押した（拡大表示を開く。ADR 0045 決定 1）。
   * 渡さなければ画像は押せない。まだ GET URL の取れない送信中の添付も押せない。
   */
  onOpenImage?: (attachmentId: string) => void;
  /**
   * 添付だけを削除する（ADR 0045 決定 9）。画像でない添付の行の「…」に出す
   * （画像の削除は拡大表示の中にある）。出すかどうかは `canDelete` と同じ判定（ADR 0012）。
   * 押したあとに確認のダイアログを出すのは呼ぶ側。
   */
  onDeleteAttachment?: (attachmentId: string) => void;
  /** 「…」を開いている添付（1 度に 1 件）。 */
  openAttachmentMenuId?: string;
  onToggleAttachmentMenu?: (attachmentId: string) => void;
  /** 「…」で出せる操作。どれも無ければ「…」自体を出さない。 */
  canEdit?: boolean;
  canDelete?: boolean;
  /**
   * 「リンクをコピー」（ADR 0040）。読めている人なら誰でもコピーできるので、権限では出し分けない。
   * まだ ID のない送信中のメッセージには渡さない（パーマリンクを作れない）。
   * label は「リンクをコピー」/「コピーしました」/「コピーできませんでした」を呼ぶ側が決める。
   */
  copyLink?: { label: string; onClick: () => void };
  /**
   * 「…」のピン留めの付け外し（ADR 0054）。出せるのは投稿できる人だけ（`authz.CanPinMessage`。判定は呼ぶ側）。
   * label は「チャンネルへピン留めする」/「チャンネルからピンを外す」（DM では「この会話に…」）を呼ぶ側が決める。
   * どちらかは message.pinnedBy の有無で見分ける。
   */
  pin?: { label: string; onClick: () => void };
  /**
   * ホバーの「後で」（ADR 0054）。読める人なら誰でも保存できる（参加していない public ルームも）。
   * saved は見る人ごとの値で、REST から来る（決定 10）。保存済みはアイコンを塗って緑にする。
   */
  save?: { saved: boolean; onClick: () => void };
  menuOpen?: boolean;
  onToggleMenu?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  editing?: MessageEditingView | null;
  /**
   * 送信者のアバターか名前、または本文のメンションのチップを押した（右のプロフィールのパネルを開く。ADR 0043 / 0050）。
   * 渡さなければアバターと名前は押せない。
   */
  onOpenProfile?: (userId: string) => void;
  /**
   * 送信者のアバターか名前にポインタを乗せたときに出すカードの中身（ADR 0050 決定 6 の追記）。
   * md 以上のマウスでだけ出す。作るのは開くときだけにしたいので、関数で受け取る。
   */
  profileHoverCard?: () => ReactNode;
  /** ホバーのカードを固定で出す（story で状態を再現するため）。 */
  forceProfileHover?: boolean;
  /**
   * リアクションの付け外し（ADR 0044）。渡さなければ、付いているリアクションを読むだけになる
   * （参加していない public ルームは投稿できないので付けられない。ADR 0044 決定 6）。
   */
  onToggleReaction?: (emoji: string) => void;
  /** ホバーの「＋」と、リアクションの行末の「＋」を押した（ピッカーの開け閉て）。「…」の onToggleMenu と同じく開閉の切り替え。 */
  onTogglePicker?: () => void;
  pickerOpen?: boolean;
  /**
   * 開いたときに出すピッカーの中身。emoji-mart をこの presentational に持ち込まないよう、外から差し込む
   * （データ（1 MB 超）を読むのも、選んだ絵文字を送るのも、外側の責務）。
   */
  picker?: ReactNode;
  /** ホバーの名前を固定で出すリアクションの絵文字（story で状態を再現するため）。 */
  forceHoverReaction?: string;
  /** ホバーしたときの見た目を固定で出す（story で状態を再現するため）。 */
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
  highlighted = false,
  onDownload,
  onImageError,
  onOpenImage,
  onDeleteAttachment,
  openAttachmentMenuId,
  onToggleAttachmentMenu,
  canEdit = false,
  canDelete = false,
  copyLink,
  pin,
  save,
  menuOpen = false,
  onToggleMenu,
  onEdit,
  onDelete,
  editing = null,
  onOpenProfile,
  profileHoverCard,
  forceProfileHover = false,
  onToggleReaction,
  onTogglePicker,
  pickerOpen = false,
  picker,
  forceHoverReaction,
  forceHover,
}: MessageItemProps) {
  const { sender, status, deleted } = message;
  // ピッカーの置き場所の基準。行そのものを測って、画面に浮かせる位置を決める（ADR 0044）
  const rowRef = useRef<HTMLElement>(null);
  // ホバーのカードの基準。乗せた方（アバターか名前）の横に出す
  const avatarRef = useRef<HTMLButtonElement>(null);
  const nameRef = useRef<HTMLButtonElement>(null);
  const [hoverAnchor, setHoverAnchor] = useState<"avatar" | "name">("avatar");
  const hover = useHoverIntent();
  function hoverBind(anchor: "avatar" | "name") {
    return {
      onPointerEnter: (event: { pointerType: string }) => {
        setHoverAnchor(anchor);
        hover.bind.onPointerEnter(event);
      },
      onPointerLeave: hover.bind.onPointerLeave,
    };
  }
  function openProfile() {
    // 押したら右のパネルが開くので、ホバーのカードは残さない
    hover.close();
    onOpenProfile?.(sender.id);
  }
  // md 以上は画面に浮かせ、モバイルは下から出るシートにする。置き方が違うのでクラスでは書き分けられない
  const desktopPicker = useMediaQuery(DESKTOP_QUERY);
  // ホバーのカードはポインタのある md 以上でだけ出す（モバイルは押せば全画面のパネルが開く）
  const hoverCardShown = profileHoverCard !== undefined && desktopPicker && (hover.open || forceProfileHover);
  // 削除済みには操作の対象がなく、送信失敗には専用の操作（再送・削除）があるので、ホバーの操作を出さない
  const hasMenu = canEdit || canDelete || copyLink !== undefined || pin !== undefined;
  // 送信中・失敗にはまだメッセージの ID がなく、保存の対象にならない
  const canSave = save !== undefined && !deleted && status === "sent";
  // リアクションは行が増減するだけで本文が変わらない（ADR 0044）。送信中・失敗・削除済みには付けられない
  const reactions = deleted || status !== "sent" ? [] : (message.reactions ?? []);
  const canReact = onTogglePicker !== undefined && !deleted && status === "sent" && editing === null;
  const actionable = status !== "failed" && !deleted && editing === null && (canReply || canReact || canSave || hasMenu);
  // 削除したらピンも外れる（ADR 0054 決定 4）ので、削除済みには出さない
  const pinnedBy = deleted ? undefined : message.pinnedBy;
  // 自分宛ては「いま起きていること」なので琥珀（ADR 0043）。既読になっても消さない。
  // スレッドで開いている親は、どれを開いているかの方が先に要るので、そちらの色を優先する
  const mentionsMe = Boolean(message.mentionsMe) && !deleted;

  return (
    <article
      ref={rowRef}
      aria-label={`${sender.name} ${message.timeLabel}${mentionsMe ? " あなた宛て" : ""}`}
      className={cx(
        "group relative flex gap-2.5 px-3 md:gap-3 md:px-4",
        message.grouped ? "py-1" : "pt-3 pb-1",
        // 飛んできた先は、どれに飛んだかが先に要るので、ほかのどの地よりも優先する（ADR 0042）
        highlighted
          ? "bg-attention-subtle"
          : threadOpen
            ? "bg-primary-subtle"
            : forceHover
              ? "bg-surface-muted"
              : mentionsMe
                ? "bg-attention-subtle hover:bg-surface-muted focus-within:bg-surface-muted"
                : "hover:bg-surface-muted focus-within:bg-surface-muted",
      )}
    >
      {status === "failed" && <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-danger" />}
      {mentionsMe && status !== "failed" && <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-attention" />}

      {message.grouped ? (
        <span aria-hidden className="w-8 shrink-0 md:w-10" />
      ) : (
        onOpenProfile ? (
          <button
            ref={avatarRef}
            type="button"
            aria-label={`${sender.name} のプロフィール`}
            onClick={openProfile}
            {...hoverBind("avatar")}
            className="mt-0.5 cursor-pointer self-start rounded-full"
          >
            <Avatar id={sender.id} name={sender.name} imageUrl={sender.avatarUrl} size="message" />
          </button>
        ) : (
          <Avatar id={sender.id} name={sender.name} imageUrl={sender.avatarUrl} size="message" className="mt-0.5" />
        )
      )}

      <div className="min-w-0 flex-1">
        {pinnedBy && (
          // 本文より先に「誰がピン留めしたか」を読ませる（Slack と同じ位置）。押せないので緑にしない
          <p className="flex items-center gap-1 pb-0.5 text-2xs font-medium text-text-secondary">
            <PinIcon className="size-3" />
            {pinnedBy} がピン留め
          </p>
        )}
        {!message.grouped && (
          <header className="flex items-baseline gap-2">
            {/* カスタムステータスは絵文字だけ（ADR 0049 決定 10）。文言はホバーで読める。
                名前のすぐ横に置きたいので、時刻との間隔（gap-2）より狭いまとまりにする */}
            <span className="flex items-baseline gap-1">
              {onOpenProfile ? (
                // 読み上げではアバターのボタンと同じ操作になるので、名前の方は Tab で止めない
                <button
                  ref={nameRef}
                  type="button"
                  tabIndex={-1}
                  onClick={openProfile}
                  {...hoverBind("name")}
                  className="cursor-pointer text-sm font-semibold text-text hover:underline"
                >
                  {sender.name}
                </button>
              ) : (
                <span className="text-sm font-semibold text-text">{sender.name}</span>
              )}
              {sender.status && <StatusEmoji status={sender.status} className="text-xs" />}
            </span>
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
          <MessageEditor editing={editing} mentionNames={message.mentionNames} />
        ) : deleted ? (
          <p className="text-lg leading-relaxed text-text-muted italic">このメッセージは削除されました</p>
        ) : (
          <div className="flex items-start gap-2">
            {/* 本文はコードブロックやリストを含むので <p> では囲めない（ADR 0051）。段落の改行は MessageBody が保つ */}
            <MessageBody
              body={message.body}
              mentionNames={message.mentionNames}
              onOpenProfile={onOpenProfile}
              trailing={message.edited ? <span className="ml-1.5 text-2xs text-text-muted">（編集済み）</span> : undefined}
              className={cx(
                "min-w-0 flex-1 text-lg leading-relaxed break-words",
                status === "pending" ? "text-text-muted" : "text-text",
              )}
            />
            {status === "pending" && (
              <span role="img" aria-label="送信中" className="mt-1.5 shrink-0 text-text-muted">
                <ClockIcon className="size-3.5" />
              </span>
            )}
          </div>
        )}

        {!deleted && !editing && message.attachments.length > 0 && (
          // 画像が複数あるときは横に並べて折り返す（縦に積むと 1 枚ごとにタイムラインが 1 画面ぶん流れる）。
          // ファイルの行は幅が決まっているので、常に 1 行を使う
          <ul className="mt-2 flex flex-wrap items-start gap-2">
            {message.attachments.map((attachment) => (
              <li key={attachment.id} className={attachment.kind === "file" ? "w-full" : undefined}>
                <Attachment
                  attachment={attachment}
                  onDownload={onDownload}
                  onImageError={onImageError}
                  onOpen={onOpenImage}
                  onDelete={canDelete ? onDeleteAttachment : undefined}
                  menuOpen={openAttachmentMenuId === attachment.id}
                  onToggleMenu={onToggleAttachmentMenu}
                />
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

        {/* リアクションの行（ADR 0044）。本文と添付の下、「N 件の返信」より上に置く。
            付いていなければ行ごと出さない（空の「＋」だけが並ぶとタイムラインが賑やかになりすぎる）。 */}
        {!editing && reactions.length > 0 && (
          <MessageReactions
            reactions={reactions}
            onToggle={onToggleReaction}
            onAdd={canReact ? onTogglePicker : undefined}
            forceHoverEmoji={forceHoverReaction}
          />
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
          {canReact && (
            <IconButton
              label="リアクションを追加"
              aria-expanded={pickerOpen}
              onClick={onTogglePicker}
              className={cx("size-7", pickerOpen && "bg-surface-muted")}
            >
              <SmilePlusIcon className="size-4" />
            </IconButton>
          )}
          {canReply && (
            <IconButton label="返信" onClick={onReply} className="size-7">
              <ReplyIcon className="size-4" />
            </IconButton>
          )}
          {canSave && (
            <IconButton
              label={save.saved ? "「後で」から外す" : "「後で」に保存"}
              aria-pressed={save.saved}
              onClick={save.onClick}
              className="size-7"
            >
              {/* IconButton の文字色（text-secondary）より後に効かせるため、色はアイコンの側に付ける */}
              <BookmarkIcon className={cx("size-4", save.saved && "text-primary")} fill={save.saved ? "currentColor" : "none"} />
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

      {hoverCardShown && (
        <ProfileHoverPopup
          anchorRef={hoverAnchor === "name" ? nameRef : avatarRef}
          label={`${sender.name} のプロフィール`}
          bind={hover.bind}
        >
          {profileHoverCard()}
        </ProfileHoverPopup>
      )}

      {pickerOpen &&
        (desktopPicker ? (
          // 画面に浮かせる（fixed）。タイムラインの中に absolute で置くと、スクロールできる範囲が
          // ピッカーのぶん広がって、いちばん下のメッセージで開いたときに下に余白ができる。
          // 入力欄より上に出すのも狙いどおり（絵文字を選んでいる間は入力しない）。
          // 中身（emoji-mart）が自前の地と角丸を持つので、枠は外側で足すだけにして二重の額縁を避ける
          <AnchoredPanel
            anchorRef={rowRef}
            label="リアクションを選ぶ"
            onDismiss={onTogglePicker}
            className="w-88 overflow-hidden rounded-md border border-border bg-surface shadow-overlay"
          >
            {picker}
          </AnchoredPanel>
        ) : (
          // モバイルは下から出るシート（メンバーのシートと同じ形）。画面が狭く、浮かせる余地がない
          <Portal>
            <div aria-hidden className="fixed inset-0 z-40 bg-overlay" onClick={onTogglePicker} />
            <div
              role="dialog"
              aria-label="リアクションを選ぶ"
              className="fixed inset-x-0 bottom-0 z-50 overflow-hidden rounded-t-lg bg-surface"
            >
              {picker}
            </div>
          </Portal>
        ))}

      {menuOpen && hasMenu && (
        <Popover label="メッセージの操作" className="top-6 right-4 w-60" onDismiss={onToggleMenu}>
          {copyLink && (
            <MenuItem icon={LinkIcon} onClick={copyLink.onClick}>
              {copyLink.label}
            </MenuItem>
          )}
          {pin && (
            <MenuItem icon={pinnedBy ? PinOffIcon : PinIcon} onClick={pin.onClick}>
              {pin.label}
            </MenuItem>
          )}
          {canEdit && (
            <MenuItem icon={PencilIcon} onClick={onEdit}>
              メッセージを編集
            </MenuItem>
          )}
          {canDelete && (
            <MenuItem icon={TrashIcon} onClick={onDelete} danger>
              メッセージを削除
            </MenuItem>
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
function MessageEditor({ editing, mentionNames }: { editing: MessageEditingView; mentionNames?: Readonly<Record<string, string>> }) {
  return (
    <div className="flex flex-col gap-1.5 pt-0.5">
      {/* 入力欄と同じリッチテキストの欄（ADR 0052）。編集ではツールバーを出さず、記号の入力とショートカットで書式を付ける */}
      <div className="rounded-md border border-border bg-surface px-1.5 py-1 has-focus-visible:outline-2 has-focus-visible:-outline-offset-2 has-focus-visible:outline-primary">
        <RichTextInput
          value={editing.value}
          onChange={editing.onChange}
          onSubmit={() => {
            if (editing.value.trim() !== "") editing.onSave?.();
          }}
          onEscape={editing.onCancel}
          mentionNames={mentionNames}
          mentionCandidates={editing.mentionCandidates}
          toolbar={false}
          label="メッセージを編集"
          autoFocus
        />
      </div>
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
