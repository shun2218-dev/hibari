"use client";

import { useEffect } from "react";

/** アクティビティがあるときのファビコン（琥珀の丸つき。docs/ui/brand/mark-activity.svg を tools/render-brand.mjs が写す）。 */
export const ACTIVITY_FAVICON = "/icon-activity.svg";

const SELECTOR = 'link[rel~="icon"][type="image/svg+xml"]';

/**
 * アクティビティが 1 以上のあいだ、ファビコンを丸つきに差し替える（ADR 0063 決定 3）。数字は出さない。
 *
 * 差し替えるのは SVG のファビコン（app/icon.svg）だけ。favicon.ico は SVG を読めないブラウザ向けで、丸は付けない。
 * Next.js はページを移るときに head の <link> を入れ直しうるので、useDocumentTitle と同じく head を見張って入れ直し返す。
 * 0 に戻ったり画面を離れたりしたら、元の href に戻す。
 */
export function useActivityFavicon(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const originals = new Map<HTMLLinkElement, string>();
    const apply = () => {
      for (const link of document.head.querySelectorAll<HTMLLinkElement>(SELECTOR)) {
        if (link.getAttribute("href") === ACTIVITY_FAVICON) continue;
        originals.set(link, link.getAttribute("href") ?? "");
        link.setAttribute("href", ACTIVITY_FAVICON);
      }
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { childList: true, subtree: true, attributes: true, attributeFilter: ["href"] });
    return () => {
      observer.disconnect();
      for (const [link, href] of originals) link.setAttribute("href", href);
    };
  }, [active]);
}
