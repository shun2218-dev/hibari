import { Button, TextButton } from "@/components/ui/button";
import { BellIcon } from "@/components/ui/icons";

/**
 * 帯の種類。
 * - desktop: タブの通知（ADR 0057）。サーバーの設定でプッシュを使えないとき（ADR 0069 決定 9）
 * - push: プッシュ通知（ADR 0069）。押すと許可を求めてから購読まで進む（決定 2）
 * - install: iPhone / iPad の Safari で、ホーム画面に追加していない。追加した hibari だけが受け取れるので（決定 1）、許可の代わりに追加のしかたを案内する
 */
export type NotificationBannerKind = "desktop" | "push" | "install";

const bannerText: Record<NotificationBannerKind, { label: string; title: string; body: string; action: string }> = {
  desktop: {
    label: "デスクトップ通知",
    title: "デスクトップ通知を有効にしますか？",
    body: "新しいメッセージを、このブラウザの通知で受け取れます",
    action: "有効にする",
  },
  push: {
    label: "プッシュ通知",
    title: "通知を有効にしますか？",
    body: "hibari を閉じていても、メンションと DM をこのブラウザで受け取れます",
    action: "有効にする",
  },
  install: {
    label: "プッシュ通知",
    title: "ホーム画面に追加すると通知が届きます",
    body: "iPhone では、ホーム画面から開いた hibari だけが通知を受け取れます",
    action: "追加のしかた",
  },
};

/**
 * サイドバーの上の「通知を有効にする」の帯（ADR 0057 決定 5、ADR 0069 決定 2）。
 *
 * ブラウザは操作をきっかけにしない許可の要求を拒むので、この帯のボタンを押したときに許可を求める。
 * 出すのは許可がまだ決まっていないときだけ（出すかと、どの種類かは呼ぶ側が決める）。「今はしない」で閉じたら、その端末では出さない。
 * 帯は種類によらず 1 つ（ADR 0069 決定 2）。`kind` を省くと、これまでのデスクトップ通知の帯になる。
 */
export function NotificationPermissionBanner({
  kind = "desktop",
  onEnable,
  onShowInstallGuide,
  onDismiss,
}: {
  kind?: NotificationBannerKind;
  /** desktop / push の「有効にする」。 */
  onEnable?: () => void;
  /** install の「追加のしかた」。ホーム画面に追加する手順のシートを開く。 */
  onShowInstallGuide?: () => void;
  onDismiss?: () => void;
}) {
  const text = bannerText[kind];
  return (
    <div role="region" aria-label={text.label} className="mx-3 mb-2 flex flex-col gap-2 rounded-md bg-surface-muted px-3 py-2.5">
      <p className="flex items-start gap-2 text-xs leading-normal text-text">
        <BellIcon className="mt-0.5 size-3.5 shrink-0 text-text-secondary" />
        <span>
          <span className="block font-semibold">{text.title}</span>
          {text.body}
        </span>
      </p>
      <div className="flex items-center gap-3 pl-5.5">
        <Button size="sm" onClick={kind === "install" ? onShowInstallGuide : onEnable}>
          {text.action}
        </Button>
        <TextButton onClick={onDismiss} className="text-xs">
          今はしない
        </TextButton>
      </div>
    </div>
  );
}
