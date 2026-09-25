"use client";

import { type ReactNode, useRef, useState } from "react";

import { MessageBody } from "@/components/chat/message-body";
import { LinkPreviewCard } from "@/components/chat/link-preview-card";
import { MessageLinkCard } from "@/components/chat/message-link-card";
import { MessageReactions } from "@/components/chat/message-reactions";
import { ProfileHoverPopup } from "@/components/chat/profile-card";
import type { MessageView } from "@/components/chat/types";
import { StatusEmoji } from "@/components/chat/user-status";
import { Avatar } from "@/components/ui/avatar";
import { TextButton } from "@/components/ui/button";
import { ClockIcon, PinIcon, ThreadIcon } from "@/components/ui/icons";
import { useHoverIntent } from "@/hooks/use-hover-intent";
import { DESKTOP_QUERY, useMediaQuery } from "@/hooks/use-media-query";
import type { MentionCandidate } from "@/lib/chat/format/mentions";
import { cx } from "@/lib/cx";

import { Attachment } from "./attachment";
import { type HoverAction, HoverActions } from "./hover-actions";
import { MessageEditor } from "./message-editor";
import { MessageMenu } from "./message-menu";
import { ReactionPicker } from "./reaction-picker";
import { ThreadSummary } from "./thread-summary";

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
  /**
   * 外部のリンクのプレビューを消す（ADR 0065 決定 5）。消せるのは投稿した本人だけなので、本人のメッセージのときだけ渡す。
   * 確認のダイアログは出さない。
   */
  onRemoveLinkPreview?: (previewId: string) => void;
  /** プレビューの「x」を出した状態で描く（story で状態を再現するため）。 */
  forceLinkPreviewRemove?: boolean;
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
   * 「…」のスレッドの返信の通知（ADR 0056 決定 5・7）。スレッドの親（返信の付いたメッセージ）にだけ出す。出すかは呼ぶ側が決める。
   * notifying が true なら「返信の通知をオフにする」、false（参加していない・オフ）なら「新しい返信の通知を受け取る」。
   * 文言は Slack の公式ヘルプのとおり。
   */
  threadNotify?: { notifying: boolean; onClick: () => void };
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
  /** ホバーの操作の名前の吹き出しを固定で出す（story で状態を再現するため）。 */
  forceHoverActionTooltip?: HoverAction;
  /** ピッカーをどのボタンから開いたことにするか（story で状態を再現するため）。 */
  forcePickerFrom?: PickerFrom;
};

/** ピッカーを開いたボタン。行の右上の操作か、メッセージの下のリアクションの「＋」か。置き場所が変わる。 */
export type PickerFrom = "actions" | "reactions";

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
  onRemoveLinkPreview,
  forceLinkPreviewRemove = false,
  canEdit = false,
  canDelete = false,
  copyLink,
  pin,
  threadNotify,
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
  forceHoverActionTooltip,
  forcePickerFrom,
}: MessageItemProps) {
  const { sender, status, deleted } = message;
  // ピッカーの置き場所の基準。行そのものを測って、画面に浮かせる位置を決める（ADR 0044）
  const rowRef = useRef<HTMLElement>(null);
  // 開いたボタンの近くに出すため、どちらから開いたかを覚えておく。開いているかどうかは親が持つ（openPickerKey）
  const addReactionRef = useRef<HTMLButtonElement>(null);
  const [pickerFromState, setPickerFrom] = useState<PickerFrom>("actions");
  const pickerFrom = forcePickerFrom ?? pickerFromState;
  function togglePickerFrom(from: PickerFrom) {
    setPickerFrom(from);
    onTogglePicker?.();
  }
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
  const hasMenu = canEdit || canDelete || copyLink !== undefined || pin !== undefined || threadNotify !== undefined;
  // 送信中・失敗にはまだメッセージの ID がなく、保存の対象にならない
  const canSave = save !== undefined && !deleted && status === "sent";
  // リアクションは行が増減するだけで本文が変わらない（ADR 0044）。送信中・失敗・削除済みには付けられない
  const reactions = deleted || status !== "sent" ? [] : (message.reactions ?? []);
  const canReact = onTogglePicker !== undefined && !deleted && status === "sent" && editing === null;
  const actionable = status !== "failed" && !deleted && editing === null && (canReply || canReact || canSave || hasMenu);
  // 自分宛ては「いま起きていること」なので琥珀（ADR 0043）。既読になっても消さない。
  // スレッドで開いている親は、どれを開いているかの方が先に要るので、そちらの色を優先する
  const mentionsMe = Boolean(message.mentionsMe) && !deleted;
  // 削除したらピンも外れる（ADR 0054 決定 4）ので、削除済みには出さない
  const pinnedBy = deleted ? undefined : message.pinnedBy;

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
                : pinnedBy
                  ? // ピン留めしたメッセージは黄土の地（Slack と同じく行ごと。ADR 0054）。自分宛ての琥珀の方を優先する
                    "bg-pinned-subtle hover:bg-surface-muted focus-within:bg-surface-muted"
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
          // 本文より先に「誰がピン留めしたか」を読ませる（Slack と同じ位置と文言）。押せないので緑にしない
          <p className="flex items-center gap-1 pb-0.5 text-xs text-text-secondary">
            <PinIcon className="size-3.5 text-pinned" fill="currentColor" />
            {pinnedBy} がピン留めしました
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

        {/* 外部のリンクのプレビュー（ADR 0065）。パーマリンクのカードと同じく本文と添付の下に並べる */}
        {!deleted && !editing && message.linkPreviews && message.linkPreviews.length > 0 && (
          <ul className="mt-2 flex flex-col gap-2">
            {message.linkPreviews.map((preview) => (
              <li key={preview.id}>
                <LinkPreviewCard preview={preview} onRemove={onRemoveLinkPreview} forceRemoveVisible={forceLinkPreviewRemove} />
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
            onAdd={canReact ? () => togglePickerFrom("reactions") : undefined}
            addRef={addReactionRef}
            addExpanded={pickerOpen && pickerFrom === "reactions"}
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
        <HoverActions
          forceHover={forceHover}
          forceTooltip={forceHoverActionTooltip}
          canReact={canReact}
          pickerOpen={pickerOpen && pickerFrom === "actions"}
          onTogglePicker={() => togglePickerFrom("actions")}
          canReply={canReply}
          onReply={onReply}
          save={canSave ? save : undefined}
          hasMenu={hasMenu}
          menuOpen={menuOpen}
          onToggleMenu={onToggleMenu}
        />
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

      {pickerOpen && (
        <ReactionPicker
          desktop={desktopPicker}
          rowRef={rowRef}
          // 「＋」はリアクションがあるときだけ描かれる。消えていたら行の右上に戻す
          addButtonRef={pickerFrom === "reactions" && reactions.length > 0 ? addReactionRef : undefined}
          picker={picker}
          onTogglePicker={onTogglePicker}
        />
      )}

      {menuOpen && hasMenu && (
        <MessageMenu
          copyLink={copyLink}
          pin={pin}
          pinnedBy={pinnedBy}
          threadNotify={threadNotify}
          canEdit={canEdit}
          canDelete={canDelete}
          onEdit={onEdit}
          onDelete={onDelete}
          onToggleMenu={onToggleMenu}
        />
      )}
    </article>
  );
}
