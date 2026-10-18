import type { ReactNode } from "react";

import { LogoMark } from "@/components/ui/logo";
import { cx } from "@/lib/cx";

/**
 * ログイン前の画面（認証・招待の受け入れ）の外枠。ロゴ（マークと文字。ADR 0063）とカードを画面の中央に置く。
 * `footer` はカードの外の下に出す（「別のアカウントで開きますか？ ログアウト」）。
 */
export function AuthShell({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-background px-4 py-10">
      <div className="flex w-full max-w-100 flex-col items-center gap-5">
        <header className="flex flex-col items-center gap-1">
          <p className="flex items-center gap-2.5 text-2xl font-bold tracking-tight text-text">
            <LogoMark className="size-10" />
            hibari
          </p>
          <p className="text-xs text-text-muted">小さな集まりのためのチャット</p>
        </header>
        <div className="w-full rounded-lg border border-border bg-surface p-6">{children}</div>
        {footer && <div className="text-xs text-text-muted">{footer}</div>}
      </div>
    </main>
  );
}

/** フォームのカードの見出しと説明。 */
export function AuthHeading({ title, description }: { title: string; description?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-xl font-bold text-text">{title}</h1>
      {description && <p className="text-xs leading-relaxed text-text-secondary">{description}</p>}
    </div>
  );
}

export type StatusTone = "primary" | "attention" | "neutral";

const toneClass: Record<StatusTone, string> = {
  primary: "bg-primary-subtle text-primary",
  attention: "bg-attention-subtle text-attention-text",
  neutral: "bg-surface-muted text-text-secondary",
};

/**
 * 操作の結果だけを伝えるカードの中身（メールを送った、変更した、リンクが使えない）。
 * アイコンの色で、成功（primary）・待っている（attention）・進めない（neutral）を分ける。
 */
export function StatusContent({
  icon,
  tone = "neutral",
  media,
  title,
  description,
  children,
}: {
  icon?: ReactNode;
  tone?: StatusTone;
  /** アイコンの丸の代わりに置くもの（招待ではワークスペースのアバター）。 */
  media?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col items-center gap-3 text-center">
        {media ?? <span className={cx("flex size-12 items-center justify-center rounded-full", toneClass[tone])}>{icon}</span>}
        <h1 className="text-xl font-bold text-text">{title}</h1>
        {description && <div className="text-xs leading-relaxed text-text-secondary">{description}</div>}
      </div>
      {children}
    </div>
  );
}
