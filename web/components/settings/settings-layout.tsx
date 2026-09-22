import Link from "next/link";
import type { ReactNode } from "react";

import { BackToChatLink } from "@/components/workspace/admin-layout";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/ui/icons";
import { cx } from "@/lib/cx";

export type SettingsSection = "profile" | "notifications" | "devices" | "appearance";

export const settingsTitles: Record<SettingsSection, string> = {
  profile: "プロフィール",
  notifications: "通知",
  devices: "ログイン中のデバイス",
  appearance: "外観",
};

const order: SettingsSection[] = ["profile", "notifications", "devices", "appearance"];

/**
 * 設定の項目ごとの行き先。行き先のない項目はナビに出さない
 * （画面をデザインに足してから、ページをつなぐまでの間、行き先のないリンクを出さないため）。
 */
export type SettingsHrefs = Partial<Record<SettingsSection, string>>;

function sectionsOf(hrefs: SettingsHrefs): { key: SettingsSection; href: string }[] {
  return order.flatMap((key) => {
    const href = hrefs[key];
    return href ? [{ key, href }] : [];
  });
}

type SettingsLayoutProps = {
  section: SettingsSection;
  hrefs: SettingsHrefs;
  /** モバイルで項目の一覧に戻る先（`/settings`）。 */
  backHref: string;
  /** チャットに戻る先。左のナビの上に出す。 */
  chatHref: string;
  children: ReactNode;
};

/** ユーザー設定。md 以上は左にナビ、モバイルは一覧（SettingsMobileMenu）と各項目を別の画面にする。 */
export function SettingsLayout({ section, hrefs, backHref, chatHref, children }: SettingsLayoutProps) {
  return (
    <div className="flex h-dvh bg-surface">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border md:flex">
        <div className="flex h-14 items-center border-b border-border px-4">
          <p className="text-xl font-bold text-text">設定</p>
        </div>
        <BackToChatLink href={chatHref} />
        <nav aria-label="設定" className="p-2">
          <ul className="flex flex-col">
            {sectionsOf(hrefs).map(({ key, href }) => (
              <li key={key}>
                <Link
                  href={href}
                  aria-current={key === section ? "page" : undefined}
                  className={cx(
                    "flex h-9.5 items-center rounded-md px-2.5 text-sm font-semibold",
                    key === section ? "bg-primary-subtle text-primary" : "text-text hover:bg-surface-muted",
                  )}
                >
                  {settingsTitles[key]}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-1 border-b border-border px-2 md:px-4">
          <Link
            href={backHref}
            aria-label="設定の一覧に戻る"
            className="inline-flex size-8 items-center justify-center rounded-sm text-text-secondary hover:bg-surface-muted md:hidden"
          >
            <ChevronLeftIcon className="size-5" />
          </Link>
          <h1 className="pl-1 text-base font-bold text-text md:pl-0">{settingsTitles[section]}</h1>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto px-4 pt-5 pb-10">
          <div className="mx-auto w-full max-w-160">{children}</div>
        </main>
      </div>
    </div>
  );
}

/** モバイルの設定のトップ。md 以上では左のナビがあるので使わない。 */
export function SettingsMobileMenu({
  hrefs,
  chatHref,
}: {
  hrefs: SettingsHrefs;
  /** チャットに戻る先。モバイルではここが設定のいちばん上の画面になる。 */
  chatHref: string;
}) {
  return (
    <div className="flex h-dvh flex-col bg-surface">
      <header className="flex h-14 shrink-0 items-center gap-1 border-b border-border px-2">
        <Link
          href={chatHref}
          aria-label="チャットに戻る"
          className="inline-flex size-8 items-center justify-center rounded-sm text-text-secondary hover:bg-surface-muted"
        >
          <ChevronLeftIcon className="size-5" />
        </Link>
        <h1 className="pl-1 text-xl font-bold text-text">設定</h1>
      </header>
      <nav aria-label="設定" className="p-2">
        <ul className="flex flex-col">
          {sectionsOf(hrefs).map(({ key, href }) => (
            <li key={key}>
              <Link
                href={href}
                className="flex h-9.5 items-center justify-between rounded-md px-2.5 text-sm font-semibold text-text hover:bg-surface-muted"
              >
                {settingsTitles[key]}
                <ChevronRightIcon className="size-4 text-text" />
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
