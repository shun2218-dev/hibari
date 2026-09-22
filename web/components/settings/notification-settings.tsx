import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { RadioCard } from "@/components/ui/choice";
import type { NotifyLevel } from "@/lib/api/types.gen";
import { notifyLevelLabels } from "@/lib/chat/notifications/notifications";
import { cx } from "@/lib/cx";

/** 全体の通知する内容（ADR 0055 決定 1）。未設定なら mentions（Slack の既定と同じ）。 */
export type NotificationLevel = NotifyLevel;

/** ユーザー設定の「通知」の 1 節（ワークスペース 1 つ分）。 */
export type WorkspaceNotificationView = { id: string; name: string; level: NotificationLevel };

const levelDescriptions: Record<NotificationLevel, string> = {
  all: "参加しているチャンネルの新しい投稿をすべて通知する",
  mentions: "メンション、DM、参加しているスレッドの返信を通知する",
  none: "通知しない。未読とメンションの数はこれまでどおり出る",
};

/**
 * ユーザー設定の「通知」。全体の設定はワークスペースごとなので（ADR 0055 決定 2）、所属するワークスペースごとに節を並べる。
 * チャンネルごとの上書きとミュートは、ルームのヘッダーの「通知」から変える（Slack と同じ入口）。
 *
 * 設定が変えるのは「通知するか」だけで、未読とメンションの件数はどれを選んでも数える（決定 1）。
 */
export function NotificationSettings({
  workspaces,
  onLevelChange,
  browser,
}: {
  workspaces: WorkspaceNotificationView[];
  onLevelChange?: (workspaceId: string, level: NotificationLevel) => void;
  /** このブラウザのデスクトップ通知（ADR 0057）。端末ごとの設定なので、ワークスペースの節の上に分けて置く。 */
  browser?: BrowserNotificationView;
}) {
  return (
    <div className="flex max-w-100 flex-col gap-8">
      {browser && <BrowserNotificationSettings {...browser} />}
      {workspaces.map((workspace) => (
        <fieldset key={workspace.id} className="flex flex-col gap-2">
          <legend className="flex items-center gap-2 pb-3">
            <Avatar id={workspace.id} name={workspace.name} size="xs" shape="square" />
            <span className="text-base font-bold text-text">{workspace.name}</span>
          </legend>
          <p className="pb-1 text-xs text-text-secondary">通知する内容</p>
          {(["all", "mentions", "none"] as const).map((level) => (
            <RadioCard
              key={level}
              // ワークスペースごとに別のラジオのまとまりにする（name が同じだと、節をまたいで 1 つしか選べない）
              name={`notification-level-${workspace.id}`}
              value={level}
              checked={workspace.level === level}
              onChange={() => onLevelChange?.(workspace.id, level)}
              title={notifyLevelLabels[level]}
              description={levelDescriptions[level]}
            />
          ))}
        </fieldset>
      ))}
      <p className="text-xs leading-relaxed text-text-muted">
        チャンネルごとの設定とミュートは、チャンネルの上にある通知のアイコンから変えられます。
      </p>
    </div>
  );
}

/**
 * ブラウザの通知の許可（Notification.permission）。unsupported は Notification API のない環境。
 * 許可はブラウザが持つので、hibari からは「default のときに求める」ことしかできない（ADR 0057 決定 5）。
 */
export type BrowserNotificationPermission = "default" | "granted" | "denied" | "unsupported";

export type BrowserNotificationView = {
  permission: BrowserNotificationPermission;
  onRequestPermission?: () => void;
  /** 通知音（ADR 0057 決定 6）。端末ごとの好みで、既定はオン。 */
  sound: boolean;
  onSoundChange?: (sound: boolean) => void;
};

const permissionText: Record<BrowserNotificationPermission, string> = {
  default: "まだ許可していません。有効にすると、hibari を開いていて別のタブを見ている間に届きます",
  granted: "有効です。hibari を開いていて別のタブを見ている間に届きます",
  denied: "ブラウザで通知が拒否されています。ブラウザの設定から許可してください",
  unsupported: "このブラウザはデスクトップ通知に対応していません",
};

/** ユーザー設定の「通知」の、このブラウザの節（デスクトップ通知の許可と通知音）。 */
function BrowserNotificationSettings({ permission, onRequestPermission, sound, onSoundChange }: BrowserNotificationView) {
  const usable = permission === "granted";
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="pb-3 text-base font-bold text-text">このブラウザ</legend>
      <div className="flex flex-col gap-2 rounded-md border border-border px-3.5 py-3">
        <span className="text-base font-semibold text-text">デスクトップ通知</span>
        <span className="text-2xs leading-normal text-text-muted">{permissionText[permission]}</span>
        {permission === "default" && (
          <Button size="sm" onClick={onRequestPermission} className="self-start">
            有効にする
          </Button>
        )}
      </div>
      <label
        className={cx(
          "flex items-start gap-2.5 rounded-md border border-border px-3.5 py-3",
          usable ? "cursor-pointer" : "cursor-not-allowed opacity-60",
        )}
      >
        {/* 本物の checkbox を使い、キーボード操作と読み上げはブラウザに任せる。色だけ primary にそろえる（入力欄と同じ） */}
        <input
          type="checkbox"
          checked={sound}
          disabled={!usable}
          onChange={(e) => onSoundChange?.(e.target.checked)}
          className="mt-1 size-3.5 cursor-pointer accent-primary disabled:cursor-not-allowed"
        />
        <span className="flex flex-col gap-0.5">
          <span className="text-base font-semibold text-text">通知音を鳴らす</span>
          <span className="text-2xs text-text-muted">デスクトップ通知を出すときに短い音を鳴らす。この端末だけの設定</span>
        </span>
      </label>
    </fieldset>
  );
}
