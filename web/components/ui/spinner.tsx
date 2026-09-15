import { cx } from "@/lib/cx";

/** 再接続中などに出す回転するリング。色は親の文字色（currentColor）に合わせる。 */
export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cx("inline-block size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent", className)}
    />
  );
}
