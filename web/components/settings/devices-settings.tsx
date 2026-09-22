import { Badge } from "@/components/ui/badge";
import { Button, TextButton } from "@/components/ui/button";
import { BrowserIcon, MonitorIcon, PhoneIcon } from "@/components/ui/icons";
import { cx } from "@/lib/cx";

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
