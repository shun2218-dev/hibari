import type { ReactNode } from "react";

import { BellIcon, BellOffIcon, CheckIcon, ClockIcon } from "@/components/ui/icons";
import { MenuItem } from "@/components/ui/menu-item";
import { Popover } from "@/components/ui/popover";

import type { RoomKind, RoomNotifyLevel } from "./types";

/** 一時的なミュートの長さ（ADR 0055）。期限の時刻はデータ層が `Clock` から求めて `muted_until` にする。 */
export type TemporaryMute = "hour" | "tomorrow";

type NotificationMenuProps = {
  kind: RoomKind;
  /** チャンネルごとの上書き。null なら全体の設定に従う。DM では使わない（ADR 0055 決定 3）。 */
  level: RoomNotifyLevel | null;
  /** 全体の設定の名前（「メンションと DM」など）。「全体の設定に従う」の補足に出す。 */
  defaultLevelLabel: string;
  /** ミュートしている。期限つきなら、いつまでかの文言（「18:30 まで」）を持つ。 */
  mute: { untilLabel?: string } | null;
  onLevelChange?: (level: RoomNotifyLevel | null) => void;
  onMute?: () => void;
  onMuteTemporarily?: (duration: TemporaryMute) => void;
  onUnmute?: () => void;
  /** 外を押す・Esc で閉じる。 */
  onDismiss?: () => void;
};

/**
 * ルームのヘッダーの「通知」のアイコンから開くメニュー（Slack と同じ入口。ADR 0055 決定 6）。
 *
 * チャンネルは「通知する内容」とミュート、DM はミュートだけを出す（DM の通知はチャンネルごとに上書きしない）。
 * ミュートしていても「通知する内容」は選べる。ミュートを外したときに、選んでおいた設定に戻るため。
 */
export function NotificationMenu({
  kind,
  level,
  defaultLevelLabel,
  mute,
  onLevelChange,
  onMute,
  onMuteTemporarily,
  onUnmute,
  onDismiss,
}: NotificationMenuProps) {
  return (
    <Popover label="通知" className="top-13 right-2 w-72 md:top-10 md:right-0" onDismiss={onDismiss}>
      {kind !== "dm" && (
        <>
          <p className="px-2.5 pt-1.5 pb-1 text-2xs font-medium text-text-secondary">通知する内容</p>
          <LevelOption selected={level === null} onClick={() => onLevelChange?.(null)} description={`いまは「${defaultLevelLabel}」`}>
            全体の設定に従う
          </LevelOption>
          <LevelOption selected={level === "all"} onClick={() => onLevelChange?.("all")}>
            すべての新しい投稿
          </LevelOption>
          <LevelOption selected={level === "mentions"} onClick={() => onLevelChange?.("mentions")}>
            メンションのみ
          </LevelOption>
          <div className="my-1.5 h-px bg-border" />
        </>
      )}
      {mute ? (
        <>
          <p className="px-2.5 pt-1.5 pb-1 text-xs text-text-secondary">
            {mute.untilLabel ? `${mute.untilLabel}ミュート中` : "ミュート中"}
          </p>
          <MenuItem icon={BellIcon} onClick={onUnmute}>
            ミュートを解除する
          </MenuItem>
        </>
      ) : (
        <>
          <MenuItem icon={BellOffIcon} onClick={onMute}>
            {/* DM は「ダイレクトメッセージをミュートする」だと折り返すので、対象を言わない（ヘッダーに相手の名前がある） */}
            {kind === "dm" ? "ミュートする" : "チャンネルをミュートする"}
          </MenuItem>
          <p className="px-2.5 pt-2 pb-1 text-2xs font-medium text-text-secondary">一時的にミュートする</p>
          <MenuItem icon={ClockIcon} onClick={() => onMuteTemporarily?.("hour")}>
            1 時間
          </MenuItem>
          <MenuItem icon={ClockIcon} onClick={() => onMuteTemporarily?.("tomorrow")}>
            明日まで
          </MenuItem>
        </>
      )}
    </Popover>
  );
}

/**
 * 「通知する内容」の 1 行。選んでいる行は右に印を付ける（Slack のメニューと同じ）。
 * 押したらすぐに保存するので、ラジオの input ではなく押しボタン（aria-pressed）にする。
 */
function LevelOption({
  selected,
  onClick,
  description,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  description?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className="flex min-h-9.5 w-full cursor-pointer items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-left hover:bg-surface-muted"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-base text-text">{children}</span>
        {description && <span className="text-2xs text-text-muted">{description}</span>}
      </span>
      <span aria-hidden className="flex w-4 shrink-0 justify-center text-primary">
        {selected && <CheckIcon className="size-4" />}
      </span>
    </button>
  );
}
