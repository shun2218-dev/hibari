import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, TextButton } from "@/components/ui/button";
import { RadioCard } from "@/components/ui/choice";
import { TextField } from "@/components/ui/field";
import { BrowserIcon, MonitorIcon, PhoneIcon } from "@/components/ui/icons";
import { cx } from "@/lib/cx";

export function ProfileSettings({
  user,
  onChangeImage,
  onDisplayNameChange,
  onHandleChange,
}: {
  user: { id: string; displayName: string; handle: string };
  onChangeImage?: () => void;
  onDisplayNameChange?: (value: string) => void;
  onHandleChange?: (value: string) => void;
}) {
  return (
    <div className="flex max-w-100 flex-col gap-5">
      <div className="flex items-center gap-3.5">
        <Avatar id={user.id} name={user.displayName} size="xl" />
        <button
          type="button"
          onClick={onChangeImage}
          className="h-8.5 rounded-sm border border-border px-3 text-sm font-medium text-primary hover:bg-surface-muted"
        >
          画像を変更
        </button>
      </div>
      <TextField label="表示名" value={user.displayName} onChange={(e) => onDisplayNameChange?.(e.target.value)} />
      <TextField label="ハンドル" mono value={`@${user.handle}`} onChange={(e) => onHandleChange?.(e.target.value.replace(/^@/, ""))} />
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
  onThemeChange,
  onDensityChange,
}: {
  theme: Theme;
  density: Density;
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
          title="ゆったり"
          description="行送り 1.75。長時間でも読み疲れしにくい"
        />
        <RadioCard
          name="density"
          value="compact"
          checked={density === "compact"}
          onChange={() => onDensityChange?.("compact")}
          title="詰める"
          description="1画面により多くの発言が入る"
        />
      </fieldset>
    </div>
  );
}
