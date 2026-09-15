import { Spinner } from "@/components/ui/spinner";
import { cx } from "@/lib/cx";

import type { ConnectionBannerStatus } from "./types";

const copy: Record<ConnectionBannerStatus, string> = {
  reconnecting: "接続が切れました。再接続しています…",
  syncing: "メッセージを同期しています",
  restored: "接続が復帰しました",
};

/**
 * メッセージ領域の上に出す接続状態。
 * 再接続中・同期中は「いま起きていること」なので琥珀、復帰は落ち着いた状態なので primary-subtle にする。
 * 読み上げは polite（入力中の操作を遮らない）。
 */
export function ConnectionBanner({ status }: { status: ConnectionBannerStatus | null }) {
  return (
    <div role="status" aria-live="polite">
      {status && (
        <p
          className={cx(
            "flex h-9 items-center justify-center gap-2 border-b border-border text-xs",
            status === "restored" ? "bg-primary-subtle text-primary" : "bg-attention-subtle text-attention-text",
          )}
        >
          {status === "reconnecting" && <Spinner />}
          {copy[status]}
        </p>
      )}
    </div>
  );
}
