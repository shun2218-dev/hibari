import { Button, TextButton } from "@/components/ui/button";
import { BellIcon } from "@/components/ui/icons";

/**
 * サイドバーの上の「デスクトップ通知を有効にする」の帯（ADR 0057 決定 5）。
 *
 * ブラウザは操作をきっかけにしない許可の要求を拒むので、この帯のボタンを押したときに許可を求める。
 * 出すのは許可がまだ決まっていないときだけ（出すかは呼ぶ側が決める）。「今はしない」で閉じたら、その端末では出さない。
 */
export function NotificationPermissionBanner({ onEnable, onDismiss }: { onEnable?: () => void; onDismiss?: () => void }) {
  return (
    <div role="region" aria-label="デスクトップ通知" className="mx-3 mb-2 flex flex-col gap-2 rounded-md bg-surface-muted px-3 py-2.5">
      <p className="flex items-start gap-2 text-xs leading-normal text-text">
        <BellIcon className="mt-0.5 size-3.5 shrink-0 text-text-secondary" />
        <span>
          <span className="block font-semibold">デスクトップ通知を有効にしますか？</span>
          新しいメッセージを、このブラウザの通知で受け取れます
        </span>
      </p>
      <div className="flex items-center gap-3 pl-5.5">
        <Button size="sm" onClick={onEnable}>
          有効にする
        </Button>
        <TextButton onClick={onDismiss} className="text-xs">
          今はしない
        </TextButton>
      </div>
    </div>
  );
}
