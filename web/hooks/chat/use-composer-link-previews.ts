"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { ComposerLinkPreviewView } from "@/components/chat/types";
import { useOrigin } from "@/hooks/use-origin";
import type { ComposerLinkPreview } from "@/lib/api/types.gen";
import { isUrlFinished, previewCandidates } from "@/lib/chat/format/link-previews";

import { useMedia } from "./use-media";

/** 本文の最後にある URL は、打ち終えたかもしれないので、この時間だけ待ってから取りに行く（ADR 0065 決定 13）。 */
export const LINK_PREVIEW_TYPING_DELAY_MS = 800;

type Entry = { state: "loading" } | { state: "ok"; preview: ComposerLinkPreview } | { state: "none" };

/**
 * 入力欄のリンクのプレビュー（ADR 0065 決定 13）。送る前に本文の URL のカードを取り、「x」で消せるようにする。
 *
 * - 取りに行くのは、URL を書き終えたとき（後ろに空白か改行が続いた）か、打つのが止まって少し経ったとき。
 *   打っている途中の URL（`https://exa`）を 1 文字ごとに取りに行かない
 * - 同じ URL は入力欄の中で 2 度取りに行かない。カードにならなかった URL（null・失敗）も覚えておく
 * - 消した URL は、送信で suppressed_link_preview_urls として送る。サーバーは最初から消した状態で付ける
 * - 取れた結果はサーバーが 30 分使い回すので、送った時点でカードが付く（決定 2）
 */
export function useComposerLinkPreviews(
  roomId: string,
  draft: string,
): {
  previews: ComposerLinkPreviewView[];
  remove: (url: string) => void;
  /** 送信に付ける、入力欄で消した URL（本文に残っているものだけ）。 */
  suppressedUrls: () => string[];
  /** 送った後に呼ぶ。消した URL の記録を空にする（取った結果は、次の下書きのために残す）。 */
  reset: () => void;
} {
  const media = useMedia();
  const origin = useOrigin();
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [removed, setRemoved] = useState<readonly string[]>([]);
  const requested = useRef(new Set<string>());

  // ルームが替わったら、取った結果も消した URL も持ち越さない（入力欄の API はルームごとに authz を通す）
  const [shownRoomId, setShownRoomId] = useState(roomId);
  if (shownRoomId !== roomId) {
    setShownRoomId(roomId);
    setEntries({});
    setRemoved([]);
  }
  useEffect(() => {
    requested.current = new Set();
  }, [roomId]);

  const candidates = useMemo(() => (origin ? previewCandidates(draft, origin) : []), [draft, origin]);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const url of candidates) {
      if (requested.current.has(url)) continue;
      const fetchPreview = () => {
        requested.current.add(url);
        setEntries((current) => ({ ...current, [url]: { state: "loading" } }));
        media.previewLink(roomId, url).then(
          (preview) =>
            setEntries((current) => ({ ...current, [url]: preview ? { state: "ok", preview } : { state: "none" } })),
          (err: unknown) => {
            // 回数の上限（429）やネットワークの失敗。カードなしで送れるので、画面には出さない
            console.error("failed to preview a link", err);
            setEntries((current) => ({ ...current, [url]: { state: "none" } }));
          },
        );
      };
      if (isUrlFinished(draft, url)) fetchPreview();
      else timers.push(setTimeout(fetchPreview, LINK_PREVIEW_TYPING_DELAY_MS));
    }
    // 打つたびに待ち直す（打っている間は取りに行かない）
    return () => timers.forEach(clearTimeout);
  }, [media, roomId, draft, candidates]);

  const previews = useMemo(
    () =>
      candidates.flatMap((url): ComposerLinkPreviewView[] => {
        if (removed.includes(url)) return [];
        const entry = entries[url];
        if (entry?.state === "loading") return [{ url, state: "loading" }];
        if (entry?.state !== "ok") return [];
        const { site_name, title, icon } = entry.preview;
        return [
          {
            url,
            state: "ok",
            siteName: site_name,
            ...(title === "" ? {} : { title }),
            ...(icon ? { iconUrl: icon.url } : {}),
          },
        ];
      }),
    [candidates, entries, removed],
  );

  return {
    previews,
    remove: (url) => setRemoved((current) => (current.includes(url) ? current : [...current, url])),
    suppressedUrls: () => removed.filter((url) => candidates.includes(url)),
    reset: () => setRemoved([]),
  };
}
