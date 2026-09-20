"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { ChevronDownIcon, SearchIcon } from "@/components/ui/icons";

import {
  filterPreviewCatalog,
  type PreviewEntry,
  type PreviewGroup,
  previewGroupOf,
  previewGroups,
  type PreviewSince,
  previewSinceLabels,
  previewSinceOrder,
} from "./catalog";

const groupIds = Object.keys(previewGroups) as PreviewGroup[];

/**
 * /dev/preview の一覧。100 件を超えるので、既定ではグループを畳んでおき、検索とフェーズで絞り込む。
 *
 * 一覧だけをクライアント側で持つ。個別の画面（`[...name]`）には手を入れない
 * （tools/shoot-ui.mjs がそのページを原寸で撮るので、枠を足すと docs/ui/screenshots/ が変わる）。
 */
export function CatalogBrowser({ entries }: { entries: PreviewEntry[] }) {
  const [query, setQuery] = useState("");
  const [since, setSince] = useState<PreviewSince | "all">("all");
  const [opened, setOpened] = useState<PreviewGroup[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);

  // 「/」で検索欄に入り、Esc で条件を捨てる。入力中の「/」は文字として通す。
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";
      if (e.key === "/" && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "Escape" && typing) {
        setQuery("");
        setSince("all");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const filtering = query.trim() !== "" || since !== "all";
  const sections = useMemo(() => {
    const hits = filterPreviewCatalog(entries, query, since);
    return groupIds
      .map((group) => ({ group, hits: hits.filter((entry) => previewGroupOf(entry) === group) }))
      .filter((section) => section.hits.length > 0);
  }, [entries, query, since]);

  // 絞り込んでいる間は開いたままにする。畳んだままだと、何件見つかったのかしか分からない。
  const isOpen = (group: PreviewGroup) => filtering || opened.includes(group);
  const toggle = (group: PreviewGroup) =>
    setOpened((prev) => (prev.includes(group) ? prev.filter((g) => g !== group) : [...prev, group]));

  const jumpTo = (group: PreviewGroup) => {
    setOpened((prev) => (prev.includes(group) ? prev : [...prev, group]));
    document.getElementById(`group-${group}`)?.scrollIntoView({ block: "start" });
  };

  return (
    <div className="flex gap-8">
      <nav aria-label="グループ" className="sticky top-10 hidden h-fit w-40 shrink-0 flex-col gap-0.5 md:flex">
        {groupIds.map((group) => {
          const count = sections.find((section) => section.group === group)?.hits.length ?? 0;
          return (
            <button
              key={group}
              type="button"
              onClick={() => jumpTo(group)}
              disabled={count === 0}
              className="flex items-center justify-between gap-2 rounded-sm px-2.5 py-1.5 text-left text-base text-text hover:bg-surface-muted disabled:text-text-muted disabled:hover:bg-transparent"
            >
              <span className="truncate">{previewGroups[group]}</span>
              <span className="shrink-0 text-2xs text-text-muted">{count}</span>
            </button>
          );
        })}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="flex flex-col gap-2">
          <label className="flex h-9 items-center gap-2 rounded-sm border border-border bg-surface px-2.5 has-focus-visible:outline-2 has-focus-visible:-outline-offset-2 has-focus-visible:outline-primary">
            <SearchIcon className="size-4 shrink-0 text-text-secondary" />
            <input
              ref={searchRef}
              type="search"
              aria-label="画面を検索"
              placeholder="画面を検索（/ で移動。名前でも表示名でも探せる）"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="min-w-0 flex-1 bg-transparent text-base text-text focus-visible:outline-none"
            />
          </label>
          <div className="flex flex-wrap gap-1.5">
            <FilterChip active={since === "all"} onClick={() => setSince("all")}>
              すべて
            </FilterChip>
            {previewSinceOrder.map((value) => (
              <FilterChip key={value} active={since === value} onClick={() => setSince(value)}>
                {previewSinceLabels[value]}
              </FilterChip>
            ))}
          </div>
        </div>

        {sections.length === 0 ? (
          <p className="py-8 text-center text-base text-text-muted">一致する画面がありません。</p>
        ) : (
          sections.map(({ group, hits }) => (
            <section key={group} id={`group-${group}`} className="flex flex-col gap-2 scroll-mt-4">
              <h2>
                <button
                  type="button"
                  onClick={() => toggle(group)}
                  aria-expanded={isOpen(group)}
                  aria-controls={`group-${group}-list`}
                  className="flex w-full items-center gap-1.5 rounded-sm py-1 text-left text-sm font-bold text-text hover:text-text-secondary"
                >
                  <ChevronDownIcon
                    className={`size-4 shrink-0 text-text-secondary ${isOpen(group) ? "" : "-rotate-90"}`}
                  />
                  {previewGroups[group]}
                  <span className="text-2xs font-normal text-text-muted">{hits.length}</span>
                </button>
              </h2>
              {isOpen(group) && (
                <ul id={`group-${group}-list`} className="rounded-md border border-border bg-surface">
                  {hits.map((entry, index) => (
                    <li key={entry.name} className={index > 0 ? "border-t border-border" : undefined}>
                      <Link
                        href={`/dev/preview/${entry.name}`}
                        className="flex items-center justify-between gap-3 px-3.5 py-2.5 hover:bg-surface-muted"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-base text-text">{entry.title}</span>
                          {entry.dark && <Tag>ダーク</Tag>}
                          {entry.mobile && <Tag>モバイル</Tag>}
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <Tag>{entry.since}</Tag>
                          <span className="font-mono text-2xs text-text-muted">{entry.name}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))
        )}
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full px-2.5 py-1 text-2xs ${
        active ? "bg-primary text-on-primary" : "bg-surface text-text-secondary hover:bg-surface-muted"
      }`}
    >
      {children}
    </button>
  );
}

/** 押せない目印（フェーズ・ダーク・モバイル）。押せるものは緑（CLAUDE.md「デザイン」）なので、ここでは使わない。 */
function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="shrink-0 rounded-full bg-surface-muted px-1.5 py-0.5 text-2xs text-text-muted">{children}</span>
  );
}
