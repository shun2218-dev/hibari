import { Alert } from "@/components/ui/alert";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, TextButton } from "@/components/ui/button";
import { RadioCard } from "@/components/ui/choice";
import { TextField } from "@/components/ui/field";
import { BrowserIcon, MonitorIcon, PhoneIcon } from "@/components/ui/icons";
import { Spinner } from "@/components/ui/spinner";
import { cx } from "@/lib/cx";

/**
 * アバター画像の状態（ADR 0020）。
 * - idle: 何もしていない
 * - uploading: 選んだ画像をアップロードしている
 * - failed: アップロードに失敗した（再試行できる）
 */
export type AvatarUploadState = "idle" | "uploading" | "failed";

export function ProfileSettings({
  user,
  avatarState = "idle",
  onChangeImage,
  onRemoveImage,
  onRetryImage,
  onDisplayNameChange,
  onHandleChange,
  onDisplayNameCommit,
  onHandleCommit,
}: {
  user: { id: string; displayName: string; handle: string; avatarUrl?: string };
  avatarState?: AvatarUploadState;
  onChangeImage?: () => void;
  onRemoveImage?: () => void;
  onRetryImage?: () => void;
  onDisplayNameChange?: (value: string) => void;
  onHandleChange?: (value: string) => void;
  /** 変更を確定する（フォーカスを外したとき）。WorkspaceSettings の名前と同じ形。 */
  onDisplayNameCommit?: () => void;
  onHandleCommit?: () => void;
}) {
  const uploading = avatarState === "uploading";
  return (
    <div className="flex max-w-100 flex-col gap-5">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3.5">
          <span className="relative inline-flex">
            <Avatar
              id={user.id}
              name={user.displayName}
              imageUrl={user.avatarUrl}
              size="xl"
              className={uploading ? "opacity-40" : undefined}
            />
            {uploading && (
              <span className="absolute inset-0 flex items-center justify-center">
                <Spinner className="size-5 text-attention" />
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={onChangeImage}
            disabled={uploading}
            className="h-8.5 rounded-sm border border-border px-3 text-sm font-medium text-primary hover:bg-surface-muted disabled:border-border disabled:bg-surface-muted disabled:text-text-muted"
          >
            画像を変更
          </button>
          {uploading ? (
            <span className="text-xs text-attention-text">アップロード中…</span>
          ) : (
            user.avatarUrl && (
              <TextButton tone="danger" onClick={onRemoveImage} className="text-sm font-semibold">
                削除
              </TextButton>
            )
          )}
        </div>
        {avatarState === "failed" && (
          <Alert tone="danger">
            画像をアップロードできませんでした
            <button type="button" onClick={onRetryImage} className="ml-2 font-semibold text-primary hover:underline">
              再試行
            </button>
          </Alert>
        )}
        <p className="text-2xs text-text-muted">PNG / JPEG / WebP、2 MB まで。正方形に切り取って表示します。</p>
      </div>
      <TextField
        label="表示名"
        value={user.displayName}
        onChange={(e) => onDisplayNameChange?.(e.target.value)}
        onBlur={onDisplayNameCommit}
      />
      <TextField
        label="ハンドル"
        mono
        value={`@${user.handle}`}
        onChange={(e) => onHandleChange?.(e.target.value.replace(/^@/, ""))}
        onBlur={onHandleCommit}
      />
    </div>
  );
}

export type DeviceKind = "browser" | "phone" | "desktop";

export type DeviceView = {
  /** セッション（refresh token の family）の ID。 */
  id: string;
  kind: DeviceKind;
  /** 「Chrome · macOS」 */
  name: string;
  /** 「現在アクティブ」「2分前」「昨日 18:24」 */
  lastActiveLabel: string;
  current: boolean;
};

const deviceIcon = { browser: BrowserIcon, phone: PhoneIcon, desktop: MonitorIcon } as const;

export function DevicesSettings({
  devices,
  onLogout,
  onLogoutOthers,
}: {
  devices: DeviceView[];
  onLogout?: (sessionId: string) => void;
  onLogoutOthers?: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm leading-relaxed text-text-secondary">
        現在 hibari にログインしているセッションの一覧です。心当たりのないデバイスがあれば、ログアウトしてからパスワードを変更してください。
      </p>
      <ul className="overflow-hidden rounded-md border border-border">
        {devices.map((device, index) => {
          const Icon = deviceIcon[device.kind];
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
                <p className="text-xs text-text-muted">{device.lastActiveLabel}</p>
              </div>
              {!device.current && (
                <TextButton tone="danger" onClick={() => onLogout?.(device.id)} className="text-sm font-semibold">
                  ログアウト
                </TextButton>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-col items-start gap-2">
        <Button variant="danger-outline" onClick={onLogoutOthers}>
          他のすべてのデバイスからログアウト
        </Button>
        <p className="text-2xs text-text-muted">このデバイス以外のセッションがすべて終了します。</p>
      </div>
    </div>
  );
}

export type Theme = "light" | "dark";
export type Density = "comfortable" | "compact";

export function AppearanceSettings({
  theme,
  density,
  densityLocked = false,
  onThemeChange,
  onDensityChange,
}: {
  theme: Theme;
  density: Density;
  /** 密度を選べなくする。行送りと余白の値がデザインにないため（docs/ui/README.md の未解決）。 */
  densityLocked?: boolean;
  onThemeChange?: (theme: Theme) => void;
  onDensityChange?: (density: Density) => void;
}) {
  return (
    <div className="flex max-w-100 flex-col gap-6">
      <fieldset className="flex flex-col gap-2">
        <legend className="pb-2 text-xs text-text-secondary">テーマ</legend>
        <RadioCard
          name="theme"
          value="light"
          checked={theme === "light"}
          onChange={() => onThemeChange?.("light")}
          title="ライト"
          description="明るい背景。日中の作業向け"
        />
        <RadioCard
          name="theme"
          value="dark"
          checked={theme === "dark"}
          onChange={() => onThemeChange?.("dark")}
          title="ダーク"
          description="暗い背景。夜間や長時間の常時表示向け"
        />
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="pb-2 text-xs text-text-secondary">表示の密度</legend>
        <RadioCard
          name="density"
          value="comfortable"
          checked={density === "comfortable"}
          onChange={() => onDensityChange?.("comfortable")}
          disabled={densityLocked}
          title="ゆったり"
          description="行送り 1.75。長時間でも読み疲れしにくい"
        />
        <RadioCard
          name="density"
          value="compact"
          checked={density === "compact"}
          onChange={() => onDensityChange?.("compact")}
          disabled={densityLocked}
          title="詰める"
          description="1画面により多くの発言が入る"
        />
      </fieldset>
    </div>
  );
}

/** 全体の通知する内容（ADR 0055 決定 1）。未設定なら mentions（Slack の既定と同じ）。 */
export type NotificationLevel = "all" | "mentions" | "none";

export const notificationLevelLabels: Record<NotificationLevel, string> = {
  all: "すべて",
  mentions: "メンションと DM",
  none: "なし",
};

/**
 * ユーザー設定の「通知」。全体の設定だけを選ぶ。チャンネルごとの上書きとミュートは、ルームのヘッダーの「通知」から変える
 * （Slack と同じ入口。ここに全ルームの一覧を並べると、ワークスペースを選ぶ場所が要る。ADR 0055 決定 2）。
 *
 * 設定が変えるのは「通知するか」だけで、未読とメンションの件数はどれを選んでも数える（決定 1）。
 */
export function NotificationSettings({
  level,
  onLevelChange,
}: {
  level: NotificationLevel;
  onLevelChange?: (level: NotificationLevel) => void;
}) {
  return (
    <div className="flex max-w-100 flex-col gap-6">
      <fieldset className="flex flex-col gap-2">
        <legend className="pb-2 text-xs text-text-secondary">通知する内容</legend>
        <RadioCard
          name="notification-level"
          value="all"
          checked={level === "all"}
          onChange={() => onLevelChange?.("all")}
          title={notificationLevelLabels.all}
          description="参加しているチャンネルの新しい投稿をすべて通知する"
        />
        <RadioCard
          name="notification-level"
          value="mentions"
          checked={level === "mentions"}
          onChange={() => onLevelChange?.("mentions")}
          title={notificationLevelLabels.mentions}
          description="メンション、DM、参加しているスレッドの返信を通知する"
        />
        <RadioCard
          name="notification-level"
          value="none"
          checked={level === "none"}
          onChange={() => onLevelChange?.("none")}
          title={notificationLevelLabels.none}
          description="通知しない。未読とメンションの数はこれまでどおり出る"
        />
      </fieldset>
      <p className="text-xs leading-relaxed text-text-muted">
        チャンネルごとの設定とミュートは、チャンネルの上にある通知のアイコンから変えられます。
      </p>
    </div>
  );
}
