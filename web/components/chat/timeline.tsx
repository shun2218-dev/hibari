"use client";

import { type ReactNode, useEffectEvent, useLayoutEffect, useRef } from "react";

import { TextButton } from "@/components/ui/button";

import { type MessageEditingView, MessageItem } from "@/components/chat/message-item/message-item";
import type { TimelineItem } from "./types";

/**
 * メッセージごとに出せる操作。編集は自分のメッセージだけ、削除は自分か admin 以上（ADR 0012）。
 * 判定はデータ層が行い、ここは結果だけを受け取る。
 */
export type MessageActions = { canEdit: boolean; canDelete: boolean };

type TimelineProps = {
  items: TimelineItem[];
  /** 読み上げの名前。スレッドのパネルはチャンネルと同じ画面に並ぶので、名前を分ける（ADR 0036）。 */
  label?: string;
  onRetry?: (key: string) => void;
  onDiscard?: (key: string) => void;
  /** 「返信」を押した（スレッドを開く。ADR 0036）。渡さなければ「返信」を出さない。 */
  onReply?: (key: string) => void;
  /** 「N 件の返信」を押した。 */
  onOpenThread?: (key: string) => void;
  /** スレッドのパネルで開いている親の key。 */
  openThreadKey?: string;
  /** 飛んできた先の key（ADR 0042）。その行に琥珀の地を敷く。消すのは呼ぶ側。 */
  highlightedKey?: string;
  /** 強調しているときに押された。時間で消えるのを待たずに消す（ADR 0042）。 */
  onClearHighlight?: () => void;
  onDownload?: (attachmentId: string) => void;
  onImageError?: (attachmentId: string, url: string) => void;
  /** インライン表示している画像を押した（拡大表示を開く。ADR 0045）。渡さなければ画像は押せない。 */
  onOpenImage?: (key: string, attachmentId: string) => void;
  /**
   * 添付だけを削除する（ADR 0045 決定 9）。画像でない添付の行の「…」に出す。
   * 出すのは `actionsFor` の `canDelete` が true のメッセージだけ（判定はメッセージの削除と同じ。ADR 0012）。
   */
  onDeleteAttachment?: (key: string, attachmentId: string) => void;
  /** 添付の「…」を開いているメッセージと添付（1 度に 1 件）。 */
  openAttachmentMenu?: { key: string; attachmentId: string };
  onToggleAttachmentMenu?: (key: string, attachmentId: string) => void;
  onMarkAllRead?: () => void;
  /** key ごとの操作の可否。渡さなければ「…」を出さない。 */
  actionsFor?: (key: string) => MessageActions;
  /**
   * key ごとの「リンクをコピー」（ADR 0040）。まだ ID のない送信中のメッセージでは undefined を返す。
   * 文言は押したあとに変わる（「コピーしました」）ので、呼ぶ側が持つ。
   */
  copyLinkFor?: (key: string) => { label: string; onClick: () => void } | undefined;
  /** key ごとのピン留めの付け外し（ADR 0054）。ピン留めできないメッセージ・人には undefined を返す。 */
  pinFor?: (key: string) => { label: string; onClick: () => void } | undefined;
  /** key ごとのスレッドの返信の通知（ADR 0056）。スレッドの親でなければ undefined を返す。 */
  threadNotifyFor?: (key: string) => { notifying: boolean; onClick: () => void } | undefined;
  /** key ごとの「後で」（ADR 0054）。保存できないメッセージには undefined を返す。 */
  saveFor?: (key: string) => { saved: boolean; onClick: () => void } | undefined;
  /** 「…」を開いているメッセージ。 */
  openMenuKey?: string;
  onToggleMenu?: (key: string) => void;
  onEdit?: (key: string) => void;
  onDelete?: (key: string) => void;
  /** 編集中のメッセージ（1 度に 1 件）。 */
  editingKey?: string;
  editing?: MessageEditingView;
  /** リアクションの付け外し（ADR 0044）。渡さなければ、付いているリアクションを読むだけになる。 */
  onToggleReaction?: (key: string, emoji: string) => void;
  /** 「リアクションを追加」を押した（ピッカーの開け閉て）。 */
  onTogglePicker?: (key: string) => void;
  /** ピッカーを開いているメッセージ（1 度に 1 件）。 */
  openPickerKey?: string;
  /** 送信者のアバターや名前、メンションを押した（右のプロフィールのパネルを開く。ADR 0050）。 */
  onOpenProfile?: (userId: string) => void;
  /** 送信者にポインタを乗せたときのカードの中身（ADR 0050 決定 6 の追記）。渡さなければカードは出ない。 */
  profileHoverCardFor?: (userId: string) => ReactNode;
  /** ホバーのカードを固定で出すメッセージ（story 用）。 */
  hoveredProfileKey?: string;
  /** ピッカーの中身。emoji-mart は動的 import なので、作るのは外側に任せる（ADR 0044 決定 7）。 */
  reactionPicker?: ReactNode;
  /** ホバーの見た目を固定で出すメッセージ（story 用）。 */
  hoveredKey?: string;
  /** リアクションのホバーの名前を固定で出す（story 用）。 */
  hoveredReaction?: { key: string; emoji: string };
  /**
   * いちばん上の近くまでスクロールした（古いメッセージを読み込むきっかけ）。
   * 内容が画面に収まってスクロールできないときも呼ぶ。もうないか、取得中かの判断は呼ぶ側が行う。
   */
  onReachStart?: () => void;
  /**
   * いちばん下の近くまでスクロールした（新しいメッセージを読み込むきっかけ。ADR 0042）。
   * 飛んだ先から下に読み進めるときだけ意味がある。もうないか、取得中かの判断は呼ぶ側が行う。
   */
  onReachEnd?: () => void;
  /**
   * この key の行を見せる（ADR 0042 の「飛ぶ」）。値が変わったときだけ動かし、いちばん下へ寄せる既定の動きより優先する。
   * メッセージの key のほか、「ここから未読」の区切り（`"unread"`）も指せる。
   */
  scrollToKey?: string;
  /**
   * 飛び先をどこに置くか。既定は画面の中ほど（前後が見えていないと、どこに飛んだのか分からないため）。
   * 「ここから未読」の線は、そこから下が全部未読なので上端に置く。
   */
  scrollToAlign?: "center" | "start";
  /**
   * いちばん下（最新）が見えているかが変わった。データ層は、見ている間に届いたメッセージを既読にする。
   * 最初に描いたときにも 1 回呼ぶ。
   */
  onAtBottomChange?: (atBottom: boolean) => void;
  /**
   * この値が変わったら、スクロールの位置に関係なくいちばん下を見せる。自分が送信したときに、上の履歴を読んでいても送ったメッセージを見せるため。
   */
  scrollToLatestKey?: number;
};

/** いちばん上からこの距離より近づいたら、古いメッセージを読み込む。1 ページを読み終える前に次を用意しておく。 */
const REACH_START_PX = 400;

/** いちばん下からこの距離より近づいたら、新しいメッセージを読み込む（飛んだ先から下に読み進めるとき）。 */
const REACH_END_PX = 400;

/** いちばん下からこの距離の内側にいれば、最新を見ているとみなす。 */
const AT_BOTTOM_PX = 4;

/** 並びの中の 1 件を data-key で引く。 */
function childByKey(list: HTMLOListElement | null, key: string): HTMLElement | undefined {
  return Array.from(list?.children ?? []).find(
    (child): child is HTMLElement => child instanceof HTMLElement && child.dataset.key === key,
  );
}

/** 描き直す前のスクロール位置の手がかり。 */
type ScrollAnchor = { key: string; offsetTop: number; atBottom: boolean };

/**
 * メッセージの並び。並び順は受け取った順のまま（seq で並べるのはデータ層の責務。CLAUDE.md ルール 3）。
 */
export function Timeline({
  items,
  label = "メッセージ",
  onRetry,
  onDiscard,
  onReply,
  onOpenThread,
  openThreadKey,
  highlightedKey,
  onClearHighlight,
  onDownload,
  onImageError,
  onOpenImage,
  onDeleteAttachment,
  openAttachmentMenu,
  onToggleAttachmentMenu,
  onMarkAllRead,
  actionsFor,
  copyLinkFor,
  pinFor,
  threadNotifyFor,
  saveFor,
  openMenuKey,
  onToggleMenu,
  onEdit,
  onDelete,
  editingKey,
  editing,
  onToggleReaction,
  onTogglePicker,
  openPickerKey,
  reactionPicker,
  onOpenProfile,
  profileHoverCardFor,
  hoveredProfileKey,
  hoveredKey,
  hoveredReaction,
  onReachStart,
  onReachEnd,
  scrollToKey,
  scrollToAlign = "center",
  onAtBottomChange,
  scrollToLatestKey,
}: TimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const anchorRef = useRef<ScrollAnchor | null>(null);
  // 呼び出し側が毎回新しい関数を渡しても、スクロール位置の合わせ直しは items が変わったときだけにする
  const reachStartAfterRender = useEffectEvent(() => onReachStart?.());
  const atBottomRef = useRef<boolean | null>(null);
  const scrollToLatestKeyRef = useRef(scrollToLatestKey);
  const scrollToKeyRef = useRef(scrollToKey);
  // スクロールのハンドラからも呼ぶので useEffectEvent は使えない。最新の関数を ref に置き、合わせ直しの effect より先に更新する
  const onAtBottomChangeRef = useRef(onAtBottomChange);
  useLayoutEffect(() => {
    onAtBottomChangeRef.current = onAtBottomChange;
  });

  function captureAnchor() {
    const el = scrollRef.current;
    const first = listRef.current?.firstElementChild;
    if (!el || !(first instanceof HTMLElement)) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= AT_BOTTOM_PX;
    anchorRef.current = { key: first.dataset.key ?? "", offsetTop: first.offsetTop, atBottom };
    if (atBottomRef.current !== atBottom) {
      atBottomRef.current = atBottom;
      onAtBottomChangeRef.current?.(atBottom);
    }
  }

  // 描き直した後にスクロール位置を合わせる。
  // - 初めて描いたとき、または最新を見ていたときは、いちばん下を見せる
  // - 上に古いメッセージが足されたときは、それまで先頭だった要素が同じ位置に見えるようにずらす（読んでいた所が飛ばないように）
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const anchor = anchorRef.current;
    const jumpToLatest = scrollToLatestKeyRef.current !== scrollToLatestKey;
    scrollToLatestKeyRef.current = scrollToLatestKey;
    const jumpTo = scrollToKeyRef.current !== scrollToKey ? scrollToKey : undefined;
    scrollToKeyRef.current = scrollToKey;
    const target = jumpTo === undefined ? undefined : childByKey(listRef.current, jumpTo);
    if (target) {
      const margin = scrollToAlign === "start" ? 0 : Math.max(0, (el.clientHeight - target.offsetHeight) / 2);
      el.scrollTop = target.offsetTop - margin;
    } else if (!anchor || anchor.atBottom || jumpToLatest) {
      el.scrollTop = el.scrollHeight;
    } else {
      const previousFirst = childByKey(listRef.current, anchor.key);
      if (previousFirst) el.scrollTop += previousFirst.offsetTop - anchor.offsetTop;
    }
    captureAnchor();
    if (el.scrollHeight <= el.clientHeight) reachStartAfterRender();
  }, [items, scrollToLatestKey, scrollToKey, scrollToAlign]);

  return (
    <div
      ref={scrollRef}
      className="min-h-0 flex-1 overflow-y-auto pb-4"
      onPointerDown={() => {
        if (highlightedKey !== undefined) onClearHighlight?.();
      }}
      onScroll={(e) => {
        captureAnchor();
        if (e.currentTarget.scrollTop < REACH_START_PX) onReachStart?.();
        const fromEnd = e.currentTarget.scrollHeight - e.currentTarget.scrollTop - e.currentTarget.clientHeight;
        if (fromEnd < REACH_END_PX) onReachEnd?.();
      }}
    >
      <ol ref={listRef} aria-label={label} className="flex flex-col">
        {items.map((item) => {
          switch (item.type) {
            case "date":
              return (
                <li key={item.key} data-key={item.key} className="flex items-center gap-3 px-4 pt-6 pb-2">
                  <span aria-hidden className="h-px flex-1 bg-border" />
                  <span className="rounded-full border border-border bg-surface-muted px-3 py-1 text-xs text-text">
                    {item.label}
                  </span>
                  <span aria-hidden className="h-px flex-1 bg-border" />
                </li>
              );
            case "unread":
              return (
                <li key={item.key} data-key={item.key} className="flex items-center gap-2 pt-4 pb-1">
                  <span aria-hidden className="h-px w-4 bg-attention" />
                  <span className="text-2xs font-semibold text-attention-text">ここから未読</span>
                  <span aria-hidden className="h-px flex-1 bg-attention" />
                  <TextButton onClick={onMarkAllRead} className="text-2xs">
                    すべて既読にする
                  </TextButton>
                  <span aria-hidden className="h-px w-4 bg-attention" />
                </li>
              );
            case "thread-divider":
              // スレッドのパネルで、親と返信の間に置く（ADR 0036）
              return item.replyCount > 0 ? (
                <li key={item.key} data-key={item.key} className="flex items-center gap-3 px-4 pt-3 pb-1">
                  <span className="text-2xs font-medium text-text-secondary">{item.replyCount} 件の返信</span>
                  <span aria-hidden className="h-px flex-1 bg-border" />
                </li>
              ) : (
                <li key={item.key} data-key={item.key} className="px-4 pt-6 text-center text-xs text-text-muted">
                  まだ返信はありません
                </li>
              );
            case "system":
              // 人の発言ではないので、アバターも名前も出さず、日付の区切りと同じ控えめな中央寄せにする（ADR 0033）
              return (
                <li
                  key={item.key}
                  data-key={item.key}
                  className="flex items-center justify-center gap-2 px-4 py-1.5 text-xs text-text-muted"
                >
                  <span>{item.text}</span>
                  <span className="font-mono text-2xs">{item.timeLabel}</span>
                </li>
              );
            case "message": {
              const { key } = item.message;
              const actions = actionsFor?.(key);
              return (
                <li key={key} data-key={key}>
                  <MessageItem
                    message={item.message}
                    forceHover={hoveredKey === key}
                    onRetry={() => onRetry?.(key)}
                    onDiscard={() => onDiscard?.(key)}
                    onReply={() => onReply?.(key)}
                    canReply={onReply !== undefined}
                    onOpenThread={() => onOpenThread?.(key)}
                    threadOpen={openThreadKey === key}
                    highlighted={highlightedKey === key}
                    onDownload={onDownload}
                    onImageError={onImageError}
                    onOpenImage={
                      onOpenImage === undefined ? undefined : (attachmentId) => onOpenImage(key, attachmentId)
                    }
                    onDeleteAttachment={
                      onDeleteAttachment === undefined
                        ? undefined
                        : (attachmentId) => onDeleteAttachment(key, attachmentId)
                    }
                    openAttachmentMenuId={openAttachmentMenu?.key === key ? openAttachmentMenu.attachmentId : undefined}
                    onToggleAttachmentMenu={
                      onToggleAttachmentMenu === undefined
                        ? undefined
                        : (attachmentId) => onToggleAttachmentMenu(key, attachmentId)
                    }
                    canEdit={actions?.canEdit}
                    canDelete={actions?.canDelete}
                    copyLink={copyLinkFor?.(key)}
                    pin={pinFor?.(key)}
                    threadNotify={threadNotifyFor?.(key)}
                    save={saveFor?.(key)}
                    menuOpen={openMenuKey === key}
                    onToggleMenu={() => onToggleMenu?.(key)}
                    onEdit={() => onEdit?.(key)}
                    onDelete={() => onDelete?.(key)}
                    editing={editingKey === key ? (editing ?? null) : null}
                    onToggleReaction={
                      onToggleReaction === undefined ? undefined : (emoji) => onToggleReaction(key, emoji)
                    }
                    onTogglePicker={onTogglePicker === undefined ? undefined : () => onTogglePicker(key)}
                    pickerOpen={openPickerKey === key}
                    picker={openPickerKey === key ? reactionPicker : undefined}
                    onOpenProfile={onOpenProfile}
                    profileHoverCard={
                      profileHoverCardFor === undefined
                        ? undefined
                        : () => profileHoverCardFor(item.message.sender.id)
                    }
                    forceProfileHover={hoveredProfileKey === key}
                    forceHoverReaction={hoveredReaction?.key === key ? hoveredReaction.emoji : undefined}
                  />
                </li>
              );
            }
          }
        })}
      </ol>
    </div>
  );
}
