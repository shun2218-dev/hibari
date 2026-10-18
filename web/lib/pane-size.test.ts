import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PANES,
  PANE_STORAGE_KEY,
  applyPaneSize,
  paneSize,
  paneSizeBootScript,
  paneVar,
  resetPaneSizesForTest,
  setPaneSize,
  subscribePaneSize,
} from "./pane-size";

afterEach(() => {
  resetPaneSizesForTest();
  localStorage.clear();
});

describe("pane-size", () => {
  it("remembers a size and puts it on the root element", () => {
    setPaneSize("sidebar", 320);

    expect(paneSize("sidebar")).toBe(320);
    expect(document.documentElement.style.getPropertyValue("--pane-sidebar")).toBe("320px");
    expect(JSON.parse(localStorage.getItem(PANE_STORAGE_KEY)!)).toEqual({ sidebar: 320 });
  });

  it("goes back to the default when the size is cleared", () => {
    setPaneSize("thread", 500);
    setPaneSize("thread", undefined);

    expect(paneSize("thread")).toBeUndefined();
    // 変数を消すと globals.css の既定に戻る（ここで px を書き戻さない）
    expect(document.documentElement.style.getPropertyValue("--pane-thread")).toBe("");
    expect(JSON.parse(localStorage.getItem(PANE_STORAGE_KEY)!)).toEqual({});
  });

  it("does not write while dragging, only when it is over", () => {
    setPaneSize("sidebar", 300, false);
    expect(document.documentElement.style.getPropertyValue("--pane-sidebar")).toBe("300px");
    expect(localStorage.getItem(PANE_STORAGE_KEY)).toBeNull();

    setPaneSize("sidebar", 300);
    expect(JSON.parse(localStorage.getItem(PANE_STORAGE_KEY)!)).toEqual({ sidebar: 300 });
  });

  it("tells subscribers about every change", () => {
    const changed = vi.fn();
    const unsubscribe = subscribePaneSize(changed);

    setPaneSize("members", 240, false);
    setPaneSize("members", 240);
    unsubscribe();
    setPaneSize("members", 260);

    expect(changed).toHaveBeenCalledTimes(2);
  });

  it("ignores sizes that are not usable numbers", () => {
    localStorage.setItem(
      PANE_STORAGE_KEY,
      JSON.stringify({ sidebar: "320", members: -1, thread: 400, nope: 100 }),
    );

    expect(paneSize("sidebar")).toBeUndefined();
    expect(paneSize("members")).toBeUndefined();
    expect(paneSize("thread")).toBe(400);
  });

  it("treats a broken or unusable storage as nothing remembered", () => {
    localStorage.setItem(PANE_STORAGE_KEY, "{ではない");

    expect(paneSize("sidebar")).toBeUndefined();
  });

  it("names the css variable after the pane", () => {
    expect(paneVar("sidebar")).toBe("--pane-sidebar");
    expect(paneVar("members")).toBe("--pane-members");
  });

  describe("最初の描画の前に当てるスクリプト", () => {
    function run(stored: unknown) {
      localStorage.setItem(PANE_STORAGE_KEY, JSON.stringify(stored));
      new Function(paneSizeBootScript)();
    }

    it("applies the remembered sizes", () => {
      run({ sidebar: 320, thread: 500 });

      expect(document.documentElement.style.getPropertyValue("--pane-sidebar")).toBe("320px");
      expect(document.documentElement.style.getPropertyValue("--pane-thread")).toBe("500px");
    });

    it("skips broken values and unknown panes", () => {
      run({ sidebar: "320", members: 0, evil: 999 });

      expect(document.documentElement.style.getPropertyValue("--pane-sidebar")).toBe("");
      expect(document.documentElement.style.getPropertyValue("--pane-members")).toBe("");
      expect(document.documentElement.style.getPropertyValue("--pane-evil")).toBe("");
    });

    it("covers every pane", () => {
      for (const pane of Object.keys(PANES)) expect(paneSizeBootScript).toContain(`"${pane}"`);
    });
  });

  it("does nothing when there is no document (server rendering)", () => {
    const document = globalThis.document;
    // @ts-expect-error サーバーでの描画を再現する
    delete globalThis.document;

    expect(() => applyPaneSize("sidebar", 300)).not.toThrow();

    globalThis.document = document;
  });
});
