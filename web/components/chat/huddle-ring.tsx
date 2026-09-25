import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { HeadphonesIcon } from "@/components/ui/icons";

import type { UserRef } from "./types";

/**
 * DM のハドルの呼び出し（ADR 0066 決定 11）。画面のどこにいても気づけるよう、md 以上は右下、モバイルは上に重ねて出す。
 *
 * 拒否のボタンは作らない（Slack にない。オーナーの回答）。止めるのは「参加」「もうすぐ参加する」と 60 秒の時間切れ。
 * 操作を奪わないよう、ダイアログではなく重ねて出すだけにする（後ろの画面はそのまま使える）。
 */
export function HuddleRing({
  caller,
  onJoin,
  onJoinSoon,
}: {
  caller: UserRef;
  onJoin?: () => void;
  onJoinSoon?: () => void;
}) {
  return (
    <section
      role="alertdialog"
      aria-label={`${caller.name} さんからのハドルミーティング`}
      className="fixed inset-x-3 top-3 z-40 rounded-lg border border-border bg-surface p-4 shadow-overlay md:inset-x-auto md:top-auto md:right-6 md:bottom-6 md:w-80"
    >
      <div className="flex items-center gap-3">
        <Avatar id={caller.id} name={caller.name} imageUrl={caller.avatarUrl} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold text-text">{caller.name}</p>
          <p className="flex items-center gap-1 text-xs text-text-secondary">
            <HeadphonesIcon className="size-3.5 shrink-0" />
            ハドルミーティングに誘っています
          </p>
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <Button variant="secondary" size="sm" onClick={onJoinSoon} className="flex-1">
          もうすぐ参加する
        </Button>
        <Button size="sm" onClick={onJoin} className="flex-1">
          <HeadphonesIcon className="size-4" />
          参加
        </Button>
      </div>
    </section>
  );
}
