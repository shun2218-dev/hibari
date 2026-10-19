import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, TextButton } from "@/components/ui/button";
import { RadioCard } from "@/components/ui/choice";
import { BrowserIcon, PhoneIcon } from "@/components/ui/icons";
import { Switch } from "@/components/ui/switch";
import type { NotifyLevel } from "@/lib/api/types.gen";
import { notifyLevelLabels } from "@/lib/chat/notifications/mute";
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
      {browser?.push?.devices && browser.push.devices.length > 0 && (
        <PushDevicesSettings devices={browser.push.devices} onStop={browser.push.onStopDevice} />
      )}
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
  /**
   * このブラウザのプッシュ通知（ADR 0069）。渡したときだけ「デスクトップ通知」のカードを「プッシュ通知」のカードに替える。
   * サーバーの設定でプッシュを使えない（`GET /api/v1/push/config` が `enabled: false`）ときは渡さない（決定 9）。
   */
  push?: PushNotificationView;
};

/**
 * このブラウザのプッシュ通知の状態（ADR 0069）。
 * - off / on: 購読していない・している（スイッチで切り替える）
 * - requesting: ブラウザの許可の確認を待っている（スイッチはオンのまま押せない）
 * - failed: 許可は出たが購読の登録に失敗した（スイッチはオフに戻す）
 * - denied: ブラウザで通知が拒否されている（hibari からは求め直せないので、スイッチを出さない）
 * - unsupported: Push API のないブラウザ
 * - install: iPhone / iPad の Safari で、ホーム画面に追加していない（追加した hibari だけが受け取れる。決定 1）
 */
export type PushNotificationState = "off" | "on" | "requesting" | "failed" | "denied" | "unsupported" | "install";

export type PushNotificationView = {
  state: PushNotificationState;
  onEnabledChange?: (enabled: boolean) => void;
  /** install のときの「追加のしかたを見る」。ホーム画面に追加する手順のシートを開く。 */
  onShowInstallGuide?: () => void;
  /** 自分の購読（`GET /api/v1/me/push-subscriptions`）。1 つ以上あれば「通知を受け取る端末」の節を出す。 */
  devices?: PushDeviceView[];
  /** ほかの端末の購読を止める（`DELETE /api/v1/me/push-subscriptions/{id}`）。 */
  onStopDevice?: (subscriptionId: string) => void;
};

/** プッシュ通知を受け取る端末（購読 1 つ = セッション 1 つ。ADR 0069 決定 3）。 */
export type PushDeviceView = {
  /** 購読の ID。 */
  id: string;
  kind: "browser" | "phone";
  /** 「Chrome · macOS」「Safari · iPhone（ホーム画面）」。サーバーが user_agent から作る（決定 4）。 */
  name: string;
  /** 「10月19日に有効にしました」 */
  enabledLabel: string;
  current: boolean;
};

const permissionText: Record<BrowserNotificationPermission, string> = {
  default: "まだ許可していません。有効にすると、hibari を開いていて別のタブを見ている間に届きます",
  granted: "有効です。hibari を開いていて別のタブを見ている間に届きます",
  denied: "ブラウザで通知が拒否されています。ブラウザの設定から許可してください",
  unsupported: "このブラウザはデスクトップ通知に対応していません",
};

const pushText: Record<PushNotificationState, string> = {
  on: "有効です。hibari を閉じていても、このブラウザに届きます。hibari のタブを見ている間は出しません",
  off: "オフです。有効にすると、hibari を閉じていてもこのブラウザに届きます",
  requesting: "ブラウザの確認で「許可」を選んでください",
  failed: "通知を受け取る準備ができませんでした。もう一度お試しください",
  denied: "ブラウザで通知が拒否されています。アドレスバーの左のアイコンから、hibari の通知を「許可」にしてください",
  unsupported: "このブラウザはプッシュ通知に対応していません",
  install: "iPhone と iPad では、hibari をホーム画面に追加すると通知を受け取れます",
};

/** ユーザー設定の「通知」の、このブラウザの節（デスクトップ通知かプッシュ通知と、通知音）。 */
function BrowserNotificationSettings({ permission, onRequestPermission, sound, onSoundChange, push }: BrowserNotificationView) {
  const usable = permission === "granted";
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="pb-3 text-base font-bold text-text">このブラウザ</legend>
      {push ? (
        <PushNotificationCard {...push} />
      ) : (
        <div className="flex flex-col gap-2 rounded-md border border-border px-3.5 py-3">
          <span className="text-base font-semibold text-text">デスクトップ通知</span>
          <span className="text-2xs leading-normal text-text-muted">{permissionText[permission]}</span>
          {permission === "default" && (
            <Button size="sm" onClick={onRequestPermission} className="self-start">
              有効にする
            </Button>
          )}
        </div>
      )}
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
          <span className="text-2xs text-text-muted">
            {/* プッシュの通知は Service Worker が出し、そこからは音を鳴らせない（ADR 0069 決定 2）。音が効くのはタブの通知だけ */}
            {push ? "タブの通知を出すときに短い音を鳴らす。この端末だけの設定" : "デスクトップ通知を出すときに短い音を鳴らす。この端末だけの設定"}
          </span>
        </span>
      </label>
    </fieldset>
  );
}

/**
 * 「プッシュ通知」のカード（ADR 0069）。切り替えられる状態（off / on / requesting / failed）だけ右にスイッチを置く。
 * 拒否・非対応・ホーム画面にない、はスイッチを押しても何も起きないので出さない（押せそうに見せない）。
 */
function PushNotificationCard({ state, onEnabledChange, onShowInstallGuide }: PushNotificationView) {
  const switchable = state === "off" || state === "on" || state === "requesting" || state === "failed";
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border px-3.5 py-3">
      <div className="flex items-start justify-between gap-3">
        <span className="flex flex-col gap-1">
          <span className="text-base font-semibold text-text">プッシュ通知</span>
          <span className={cx("text-2xs leading-normal", state === "failed" ? "text-danger" : "text-text-muted")}>
            {pushText[state]}
          </span>
        </span>
        {switchable && (
          <Switch
            label="プッシュ通知"
            hideLabel
            // 確認を待っている間は、押した結果（オン）を見せたまま押せなくする。失敗したらオフに戻す
            checked={state === "on" || state === "requesting"}
            disabled={state === "requesting"}
            onChange={onEnabledChange}
            className="mt-0.5"
          />
        )}
      </div>
      {state === "install" && (
        <Button size="sm" onClick={onShowInstallGuide} className="self-start">
          追加のしかたを見る
        </Button>
      )}
    </div>
  );
}

const pushDeviceIcon = { browser: BrowserIcon, phone: PhoneIcon } as const;

/**
 * 「通知を受け取る端末」（ADR 0069 決定 4）。見た目は「ログイン中のデバイス」（settings/devices）にそろえる。
 * 購読はセッションに結び付くので（決定 3）、ここで止めるのはプッシュだけで、その端末のログインは残る。
 */
function PushDevicesSettings({ devices, onStop }: { devices: PushDeviceView[]; onStop?: (subscriptionId: string) => void }) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="pb-1 text-base font-bold text-text">通知を受け取る端末</legend>
      <p className="text-xs leading-relaxed text-text-secondary">プッシュ通知を有効にした端末です。ログアウトした端末には届きません</p>
      <ul className="overflow-hidden rounded-md border border-border">
        {devices.map((device, index) => {
          const Icon = pushDeviceIcon[device.kind];
          return (
            <li
              key={device.id}
              className={cx(
                "flex items-center gap-3 px-3.5 py-3",
                index > 0 && "border-t border-border",
                device.current && "bg-surface-muted",
              )}
            >
              <span
                className={cx(
                  "flex size-9 shrink-0 items-center justify-center rounded-sm text-text-secondary",
                  !device.current && "bg-surface-muted",
                )}
              >
                <Icon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2">
                  <span className="truncate text-base text-text">{device.name}</span>
                  {device.current && <Badge tone="primary">このデバイス</Badge>}
                </p>
                <p className="text-xs text-text-muted">{device.enabledLabel}</p>
              </div>
              {/* いまの端末はカードのスイッチで止める。入口を 2 つにしない */}
              {!device.current && (
                <TextButton tone="danger" onClick={() => onStop?.(device.id)} className="text-sm font-semibold">
                  停止する
                </TextButton>
              )}
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}
