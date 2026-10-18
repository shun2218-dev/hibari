import { cx } from "@/lib/cx";

/**
 * オン・オフを切り替えるスイッチ（WAI-ARIA の switch）。押せるものなので、オンの地は緑（docs/ui/tokens.md）。
 * 文字は左に置く（Slack の「未読メッセージ」と同じ）。押せる範囲は文字とスイッチの両方。
 */
export function Switch({
  label,
  checked,
  onChange,
  className,
}: {
  label: string;
  checked: boolean;
  onChange?: (checked: boolean) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange?.(!checked)}
      className={cx("flex shrink-0 cursor-pointer items-center gap-2 text-sm font-medium text-text-secondary", className)}
    >
      {label}
      <span
        aria-hidden
        className={cx(
          "relative flex h-5 w-9 items-center rounded-full border transition-colors",
          checked ? "border-primary bg-primary" : "border-border bg-surface-muted",
        )}
      >
        <span
          className={cx(
            "absolute size-3.5 rounded-full transition-transform",
            checked ? "translate-x-4.5 bg-on-primary" : "translate-x-0.5 bg-text-secondary",
          )}
        />
      </span>
    </button>
  );
}
