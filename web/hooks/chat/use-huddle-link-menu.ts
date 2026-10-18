"use client";

import { useEffect, useState } from "react";

import type { HuddleHeaderMenu } from "@/components/chat/room-header";
import { useOrigin } from "@/hooks/use-origin";
import { buildHuddleLink } from "@/lib/chat/format/links";

/** 「コピーしました」を出しておく時間（メッセージの「リンクをコピー」と同じ。ADR 0040）。 */
const COPIED_LABEL_MS = 2_000;

/**
 * 「ハドルミーティングのリンクをコピー」のメニュー（ADR 0067 決定 1）。ヘッダーの「⌄」とハドルの画面・帯の「…」で使う。
 * リンクはルームを指すので、ハドルが進行中でなくてもコピーできる。コピーしたら項目の文言を短い間だけ変える（トーストは出さない）。
 * ルームが決まっていなければ undefined（メニューごと出さない）。
 */
export function useHuddleLinkMenu(room: { workspaceId: string; roomId: string } | undefined): HuddleHeaderMenu | undefined {
  const origin = useOrigin();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_LABEL_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  if (!room || origin === undefined) return undefined;
  return {
    open,
    copied,
    onToggle: () => setOpen((v) => !v),
    onCopyLink: async () => {
      try {
        await navigator.clipboard.writeText(buildHuddleLink(origin, room));
        setCopied(true);
      } catch (err) {
        // クリップボードが使えない・拒否された（メッセージのリンクと同じく、代わりの仕組みは入れない）
        console.error("failed to copy a huddle link", err);
      }
    },
  };
}
