import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ACTIVITY_FAVICON, useActivityFavicon } from "./use-activity-favicon";

/** Next.js が app/icon.svg と app/favicon.ico から出す <link> と同じ形。 */
function addIcons(): { svg: HTMLLinkElement; ico: HTMLLinkElement } {
  const svg = document.createElement("link");
  svg.rel = "icon";
  svg.type = "image/svg+xml";
  svg.setAttribute("href", "/icon.svg?abc123");
  const ico = document.createElement("link");
  ico.rel = "icon";
  ico.setAttribute("href", "/favicon.ico");
  document.head.append(svg, ico);
  return { svg, ico };
}

describe("useActivityFavicon", () => {
  let icons: { svg: HTMLLinkElement; ico: HTMLLinkElement };

  beforeEach(() => {
    icons = addIcons();
  });

  afterEach(() => {
    document.head.innerHTML = "";
  });

  it("アクティビティがあるあいだ SVG のファビコンを丸つきにし、なくなったら戻す", () => {
    const { rerender } = renderHook(({ active }) => useActivityFavicon(active), { initialProps: { active: true } });
    expect(icons.svg.getAttribute("href")).toBe(ACTIVITY_FAVICON);
    // favicon.ico は SVG を読めないブラウザ向けなので、丸は付けない
    expect(icons.ico.getAttribute("href")).toBe("/favicon.ico");

    rerender({ active: false });
    expect(icons.svg.getAttribute("href")).toBe("/icon.svg?abc123");
  });

  it("アクティビティがなければ触らない", () => {
    renderHook(() => useActivityFavicon(false));
    expect(icons.svg.getAttribute("href")).toBe("/icon.svg?abc123");
  });

  it("画面を離れたら戻す", () => {
    const { unmount } = renderHook(() => useActivityFavicon(true));
    unmount();
    expect(icons.svg.getAttribute("href")).toBe("/icon.svg?abc123");
  });

  it("Next.js がページを移るときに <link> を入れ直しても、丸つきに入れ直し返す", async () => {
    renderHook(() => useActivityFavicon(true));
    icons.svg.remove();
    const fresh = addIcons().svg;
    await waitFor(() => expect(fresh.getAttribute("href")).toBe(ACTIVITY_FAVICON));
  });
});
