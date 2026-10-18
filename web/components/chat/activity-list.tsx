"use client";

import Link from "next/link";
import { type ComponentType, Fragment } from "react";

import { Avatar } from "@/components/ui/avatar";
import { AtSignIcon, BellIcon, DmIcon, HashIcon, LockIcon, PaperclipIcon, SmileIcon, ThreadIcon } from "@/components/ui/icons";
import { Switch } from "@/components/ui/switch";
import { Tabs } from "@/components/ui/tabs";
import { cx } from "@/lib/cx";

import { MessageBody } from "./message-body";
import type { ActivityFilter, ActivityItemView, ActivityReason } from "./types";

type ActivityListProps = {
  filter: ActivityFilter;
  onChangeFilter?: (filter: ActivityFilter) => void;
  /** 「未読メッセージ」の切り替え（ADR 0058 決定 3）。オンなら未読だけを並べる（絞るのはサーバー）。 */
  unreadOnly: boolean;
  onToggleUnreadOnly?: () => void;
  /** 選んでいるタブの 1 件。新しい順（並べるのはデータ層）。取得中は undefined。 */
  items?: ActivityItemView[];
  /** ホバーの見た目を固定で出す 1 件（story で状態を再現するため）。 */
  hoveredKey?: string;
  /** いちばん下の近くまでスクロールした（続きを読み込むきっかけ）。 */
  onReachEnd?: () => void;
  /**
   * pane はサイドバーの列に出す形。preview は左のメニューにポインタを乗せたときに重ねて出す形（ADR 0058 の追記）で、
   * タブを出さず（「すべて」だけ）、見出しの右に「未読メッセージ」を置く（Slack と同じ）。
   */
  variant?: "pane" | "preview";
};

const TABS: readonly { value: ActivityFilter; label: string }[] = [
  { value: "all", label: "すべて" },
  { value: "dm", label: "DM" },
  { value: "mention", label: "メンション" },
  { value: "thread", label: "スレッド" },
  { value: "reaction", label: "リアクション" },
];

const EMPTY: Record<ActivityFilter, { title: string; hint: string }> = {
  all: { title: "アクティビティはまだありません", hint: "メンション・DM・スレッドの返信・リアクションが、ここに並びます" },
  dm: { title: "DM はまだありません", hint: "ダイレクトメッセージが届くと、ここに並びます" },
  mention: { title: "メンションはまだありません", hint: "あなた宛てのメンションが、ここに並びます" },
  thread: { title: "スレッドの返信はまだありません", hint: "参加しているスレッドに返信があると、ここに並びます" },
  reaction: { title: "リアクションはまだありません", hint: "あなたのメッセージに付いたリアクションが、ここに並びます" },
};

const PANEL_ID = "activity-panel";

/** いちばん下からこの距離より近づいたら、続きを読み込む（タイムラインと同じ考え方）。 */
const REACH_END_PX = 400;

/**
 * アクティビティ（ADR 0058。Slack の「アクティビティ」）。左のメニューから開き、サイドバーの列に出す。
 * 通知の対象になったメッセージと、自分のメッセージに付いたリアクションを、**メッセージ単位で**新しい順に並べる。
 * 押すとそのメッセージへ飛ぶ（ADR 0042）。サイドバーの中身はそのまま残る。
 */
export function ActivityList({
  filter,
  onChangeFilter,
  unreadOnly,
  onToggleUnreadOnly,
  items,
  hoveredKey,
  onReachEnd,
  variant = "pane",
}: ActivityListProps) {
  const preview = variant === "preview";
  const unreadSwitch = <Switch label="未読メッセージ" checked={unreadOnly} onChange={() => onToggleUnreadOnly?.()} />;
  return (
    <section aria-labelledby={`activity-title-${variant}`} className="flex h-full flex-col bg-surface">
      <header className={cx("flex shrink-0 items-center justify-between gap-2 px-4", preview ? "h-14 border-b border-border" : "h-16")}>
        <h1 id={`activity-title-${variant}`} className={cx("font-bold text-text", preview ? "text-lg" : "text-xl")}>
          アクティビティ
        </h1>
        {preview && unreadSwitch}
      </header>

      {!preview && (
        <>
          {/* 5 つのタブはサイドバーの幅に収まらないので、横にスクロールさせる */}
          <div className="shrink-0 overflow-x-auto border-b border-border px-4 scrollbar-none">
            <Tabs label="アクティビティ" items={TABS} value={filter} onChange={onChangeFilter} panelId={PANEL_ID} bordered={false} />
          </div>
          {/* 見出しの右にはサイドバーの幅では収まらないので、一覧の上に置く */}
          <div className="flex shrink-0 justify-end px-4 pt-3 pb-1">{unreadSwitch}</div>
        </>
      )}

      <div id={preview ? undefined : PANEL_ID} role={preview ? undefined : "tabpanel"} className="flex min-h-0 flex-1 flex-col">
        {items === undefined ? null : items.length === 0 ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
            <BellIcon className="size-6 text-text-muted" />
            <p className="text-base font-medium text-text">{unreadOnly ? "未読のアクティビティはありません" : EMPTY[filter].title}</p>
            <p className="text-xs leading-relaxed text-text-muted">
              {unreadOnly ? "「未読メッセージ」を外すと、読んだものも並びます" : EMPTY[filter].hint}
            </p>
          </div>
        ) : (
          <ol
            aria-label={TABS.find((tab) => tab.value === filter)?.label}
            className={cx("min-h-0 flex-1 overflow-y-auto px-3 pb-4", preview && "pt-1")}
            onScroll={(e) => {
              const el = e.currentTarget;
              if (el.scrollHeight - el.scrollTop - el.clientHeight < REACH_END_PX) onReachEnd?.();
            }}
          >
            {items.map((item, index) => (
              <Fragment key={item.key}>
                {/* 日付の区切り（Slack と同じ）。タイムラインの区切りと同じ見た目にする */}
                {item.dateLabel !== items[index - 1]?.dateLabel && (
                  <li aria-hidden className="flex items-center gap-3 px-1 pt-4 pb-2">
                    <span className="h-px flex-1 bg-border" />
                    <span className="rounded-full border border-border bg-surface-muted px-3 py-1 text-xs text-text">{item.dateLabel}</span>
                    <span className="h-px flex-1 bg-border" />
                  </li>
                )}
                <li className="pb-2">
                  <ActivityCard item={item} forceHover={hoveredKey === item.key} />
                </li>
              </Fragment>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

/**
 * 1 件の「何が起きたか」を 1 つの理由で言う。複数に当たるときは、本人に向いている順（メンション → スレッド → DM →
 * 投稿）で選ぶ。印（アバターの右下）も同じ理由から選ぶ。
 */
const REASON_ORDER: readonly ActivityReason[] = ["reaction", "mention", "thread", "dm", "channel"];

const REASON_ICON: Record<ActivityReason, ComponentType<{ className?: string }>> = {
  mention: AtSignIcon,
  thread: ThreadIcon,
  dm: DmIcon,
  channel: HashIcon,
  reaction: SmileIcon,
};

function primaryReason(reasons: readonly ActivityReason[]): ActivityReason {
  return REASON_ORDER.find((reason) => reasons.includes(reason)) ?? "channel";
}

function reasonText(reason: ActivityReason, dm: boolean): string {
  switch (reason) {
    case "reaction":
      return "あなたのメッセージにリアクション";
    case "mention":
      return dm ? "ダイレクトメッセージでメンション" : "でメンション";
    case "thread":
      return "のスレッドへの返信";
    case "dm":
      return "ダイレクトメッセージ";
    case "channel":
      return "への投稿";
  }
}

function ActivityCard({ item, forceHover }: { item: ActivityItemView; forceHover: boolean }) {
  const reason = primaryReason(item.reasons);
  const ReasonIcon = REASON_ICON[reason];
  const dm = item.room.kind === "dm";
  const reaction = reason === "reaction";
  // DM はルーム名が相手の名前なので、「# 名前」のチップを出さずに言葉だけにする
  const showRoom = !dm && reason !== "dm";
  return (
    <Link
      href={item.href}
      className={cx(
        "flex gap-2.5 rounded-md border border-border p-3",
        forceHover ? "bg-surface-muted" : "hover:bg-surface-muted focus-visible:bg-surface-muted",
      )}
    >
      <span className="relative h-fit shrink-0">
        <Avatar id={item.actor.id} name={item.actor.name} imageUrl={item.actor.avatarUrl} size="sm" />
        <span
          aria-hidden
          className="absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full border border-border bg-surface text-text-secondary"
        >
          <ReasonIcon className="size-2.5" />
        </span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-baseline gap-2">
          <span className={cx("min-w-0 flex-1 truncate text-sm text-text", item.unread ? "font-bold" : "font-semibold")}>
            {item.actor.name}
          </span>
          {/* 未読は名前の太字と琥珀の点で示す（いま起きていること。押せるのはカード全体で、点ではない） */}
          {item.unread && (
            <span className="size-2 shrink-0 self-center rounded-full bg-attention">
              <span className="sr-only">未読</span>
            </span>
          )}
          <time className="shrink-0 font-mono text-2xs text-text-muted">{item.timeLabel}</time>
        </span>
        <span className="flex min-w-0 items-center gap-1 text-2xs text-text-secondary">
          {reaction ? (
            <span className="truncate">{reasonText(reason, dm)}</span>
          ) : (
            <>
              {showRoom && <RoomChip kind={item.room.kind} name={item.room.name} />}
              <span className="truncate">{reasonText(reason, dm)}</span>
            </>
          )}
        </span>
        {item.threadRootExcerpt && reason === "thread" && (
          <span className="truncate text-2xs text-text-muted">「{item.threadRootExcerpt}」</span>
        )}
        {reaction ? (
          <span className="flex min-w-0 items-center gap-2 pt-0.5">
            <span className="text-lg leading-none">{item.reactionEmoji}</span>
            <span className="min-w-0 flex-1 truncate text-sm text-text-muted">{item.body}</span>
          </span>
        ) : (
          item.body !== "" && (
            <MessageBody
              body={item.body}
              mentionNames={item.mentionNames}
              interactive={false}
              className="line-clamp-2 pt-0.5 text-sm leading-relaxed break-words text-text"
            />
          )
        )}
        {!reaction && item.attachmentCount > 0 && (
          <span className="flex items-center gap-1 pt-0.5 text-2xs text-text-muted">
            <PaperclipIcon className="size-3" />
            {item.attachmentCount} 件の添付
          </span>
        )}
      </span>
    </Link>
  );
}

function RoomChip({ kind, name }: { kind: "public" | "private" | "dm"; name: string }) {
  return (
    <span className="flex min-w-0 shrink items-center gap-0.5 rounded-sm bg-surface-muted px-1.5 py-0.5 font-medium text-text-secondary">
      {kind === "private" ? (
        <LockIcon aria-label="非公開チャンネル" aria-hidden={false} role="img" className="size-3 shrink-0" />
      ) : (
        <span aria-label="公開チャンネル">#</span>
      )}
      <span className="truncate">{name}</span>
    </span>
  );
}
