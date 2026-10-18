import Link from "next/link";
import type { ComponentProps } from "react";

import { cx } from "@/lib/cx";

/** 緑の文字リンク。遷移するものは button ではなく a にする（新しいタブで開ける・履歴に残る）。 */
export function TextLink({ className, ...props }: ComponentProps<typeof Link>) {
  return <Link className={cx("font-medium text-primary hover:underline", className)} {...props} />;
}

/** 見た目は全幅の secondary ボタンだが、遷移するので a にする（「ログインに戻る」「ホームに戻る」）。 */
export function ButtonLink({ className, ...props }: ComponentProps<typeof Link>) {
  return (
    <Link
      className={cx(
        "inline-flex h-11 w-full items-center justify-center rounded-md border border-border bg-surface text-base font-semibold text-text hover:bg-surface-muted",
        className,
      )}
      {...props}
    />
  );
}
