import Link from "next/link";
import type { ReactNode } from "react";

import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ChevronLeftIcon } from "@/components/ui/icons";
import { cx } from "@/lib/cx";

import { roleLabel, type WorkspaceRole } from "./types";

export type AdminSection = "settings" | "members" | "invites";

type WorkspaceAdminLayoutProps = {
  workspace: { id: string; name: string };
  currentUser: { id: string; name: string; avatarUrl?: string; role: WorkspaceRole };
  section: AdminSection;
  memberCount: number;
  activeInviteCount: number;
  hrefs: Record<AdminSection, string>;
  /** チャットに戻る先（`/w/{id}`）。左のナビの上と、モバイルのヘッダーの「戻る」に使う。 */
  backHref: string;
  children: ReactNode;
};

const titles: Record<AdminSection, string> = {
  settings: "ワークスペース設定",
  members: "メンバー",
  invites: "招待リンク",
};

/** 管理画面と設定は全画面なので、チャットに戻る道をナビの上に置く。 */
export function BackToChatLink({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="flex h-9.5 items-center gap-1.5 px-2.5 pt-2.5 text-sm font-medium text-text-secondary hover:text-text"
    >
      <ChevronLeftIcon className="size-4" />
      チャットに戻る
    </Link>
  );
}

export function WorkspaceAdminLayout({
  workspace,
  currentUser,
  section,
  memberCount,
  activeInviteCount,
  hrefs,
  backHref,
  children,
}: WorkspaceAdminLayoutProps) {
  const items: Array<{ key: AdminSection; count?: number }> = [
    { key: "settings" },
    { key: "members", count: memberCount },
    { key: "invites", count: activeInviteCount },
  ];

  return (
    <div className="flex h-dvh bg-surface">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border md:flex">
        <div className="flex h-14 items-center gap-3 border-b border-border px-4">
          <Avatar id={workspace.id} name={workspace.name} size="xs" shape="square" />
          <span className="truncate text-base font-bold text-text">{workspace.name}</span>
        </div>
        <BackToChatLink href={backHref} />
        <nav aria-label="ワークスペースの管理" className="flex-1 p-2">
          <ul className="flex flex-col">
            {items.map((item) => {
              const current = item.key === section;
              return (
                <li key={item.key}>
                  <Link
                    href={hrefs[item.key]}
                    aria-current={current ? "page" : undefined}
                    className={cx(
                      "flex h-9.5 items-center justify-between rounded-md px-2.5 text-sm font-semibold",
                      current ? "bg-primary-subtle text-primary" : "text-text hover:bg-surface-muted",
                    )}
                  >
                    {titles[item.key]}
                    {item.count !== undefined && (
                      <span className="font-mono text-2xs text-text-secondary">{item.count}</span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="flex h-12.5 items-center gap-3 border-t border-border px-4">
          <Avatar id={currentUser.id} name={currentUser.name} imageUrl={currentUser.avatarUrl} size="xs" />
          <span className="flex-1 truncate text-sm text-text-secondary">{currentUser.name}</span>
          <Badge>{roleLabel[currentUser.role]}</Badge>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-1 border-b border-border px-2 md:px-4">
          <Link
            href={backHref}
            aria-label="戻る"
            className="inline-flex size-8 items-center justify-center rounded-sm text-text-secondary hover:bg-surface-muted md:hidden"
          >
            <ChevronLeftIcon className="size-5" />
          </Link>
          <h1 className="pl-1 text-base font-bold text-text md:pl-0">{titles[section]}</h1>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto px-4 pt-5 pb-10">
          <div className="mx-auto w-full max-w-160">{children}</div>
        </main>
      </div>
    </div>
  );
}
