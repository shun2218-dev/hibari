"use client";

import type { LexicalEditor } from "lexical";
import { useLayoutEffect, useState } from "react";

import { Avatar } from "@/components/ui/avatar";
import { HashIcon, LockIcon, MegaphoneIcon } from "@/components/ui/icons";
import { Portal } from "@/components/ui/portal";
import { type PanelPlacement, placeAboveCaret } from "@/lib/anchored-position";
import { cx } from "@/lib/cx";

import { MentionOption, type Suggestion } from "./mention";

/**
 * 補完の候補。キャレットの上に出す（下は入力欄の外で切れる）。位置は `placeAboveCaret` で決め、Portal で body の直下に置く。
 * 候補の見た目は textarea のときと同じ（ADR 0043）。`#` のときはチャンネルの候補を、サイドバーと同じ印（`#` / 鍵）で並べる（ADR 0062）。
 */
export function MentionMenu({
  options,
  active,
  onChoose,
  onHighlight,
  editor,
}: {
  options: MentionOption[];
  active: number;
  onChoose: (option: MentionOption) => void;
  onHighlight: (index: number) => void;
  editor: LexicalEditor;
}) {
  const [menu, setMenu] = useState<HTMLDivElement | null>(null);
  const [placement, setPlacement] = useState<PanelPlacement | null>(null);

  useLayoutEffect(() => {
    if (!menu) return;
    const place = () => {
      const range = window.getSelection()?.rangeCount ? window.getSelection()?.getRangeAt(0) : null;
      const rect = range?.getBoundingClientRect();
      const root = editor.getRootElement()?.getBoundingClientRect();
      // 空の行ではキャレットの矩形が取れないので、入力欄の左上を使う
      const caret = rect && rect.height > 0 ? rect : root;
      if (!caret) return;
      setPlacement(
        placeAboveCaret(caret, { width: menu.offsetWidth, height: menu.offsetHeight }, { width: window.innerWidth, height: window.innerHeight }),
      );
    };
    place();
    window.addEventListener("resize", place);
    document.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      document.removeEventListener("scroll", place, true);
    };
  }, [editor, menu, options.length]);

  return (
    <Portal>
      <div
        ref={setMenu}
        style={placement === null ? { top: 0, left: 0, opacity: 0 } : { top: placement.top, left: placement.left }}
        className="fixed z-50 w-80 overflow-hidden rounded-md border border-border bg-surface shadow-overlay"
      >
        <ul
          aria-label={options[0]?.suggestion.type === "channel" ? "チャンネルの候補" : "メンションの候補"}
          role="listbox"
          className="max-h-64 overflow-y-auto py-1"
        >
          {options.map((option, i) => {
            return (
              <li key={option.key} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  tabIndex={-1}
                  // 押し下げでフォーカスを奪うと、入力欄のキャレットが消えて差し込む先がなくなる
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onChoose(option);
                  }}
                  onMouseEnter={() => onHighlight(i)}
                  className={cx("flex w-full items-center gap-2 px-3 py-1.5 text-left", i === active && "bg-surface-muted")}
                >
                  <SuggestionRow suggestion={option.suggestion} />
                </button>
              </li>
            );
          })}
        </ul>
        {/* 操作の案内（Slack と同じ） */}
        <p className="flex gap-3 border-t border-border px-3 py-1.5 text-2xs text-text-muted">
          <span>↑↓ で移動</span>
          <span>↵ で選択</span>
          <span>esc：キャンセル</span>
        </p>
      </div>
    </Portal>
  );
}

function SuggestionRow({ suggestion }: { suggestion: Suggestion }) {
  if (suggestion.type === "channel") {
    const { channel } = suggestion;
    return (
      <>
        <span className="flex size-6 shrink-0 items-center justify-center text-text-secondary">
          {channel.private ? (
            <LockIcon aria-label="非公開" aria-hidden={false} role="img" className="size-3.5" />
          ) : (
            <HashIcon className="size-4" />
          )}
        </span>
        <span className="truncate text-base font-semibold text-text">{channel.name}</span>
      </>
    );
  }
  const candidate = suggestion.candidate;
  if (candidate.kind === "user") {
    return (
      <>
        <Avatar id={candidate.id} name={candidate.name} imageUrl={candidate.avatarUrl} size="sm" />
        <span className="truncate text-base font-semibold text-text">{candidate.name}</span>
        <span className="truncate text-xs text-text-muted">@{candidate.handle}</span>
      </>
    );
  }
  return (
    <>
      {/* 全員宛ては個人の写真の代わりにメガホン（Slack と同じ。オーナーの要望、2026-09-21） */}
      <span aria-hidden className="flex size-6 shrink-0 items-center justify-center text-text-secondary">
        <MegaphoneIcon className="size-4" />
      </span>
      <span className="text-base font-semibold text-text">@{candidate.kind}</span>
      <span className="truncate text-xs text-text-muted">{candidate.description}</span>
    </>
  );
}
