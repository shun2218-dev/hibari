import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { COMPOSER_TOOLBAR_STORAGE_KEY, setComposerToolbarVisible } from "@/lib/composer-toolbar";

import { useComposerToolbar } from "./use-composer-toolbar";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  setComposerToolbarVisible(true);
});

describe("useComposerToolbar（ADR 0052 の追記）", () => {
  it("覚えていなければツールバーを出す", () => {
    const { result } = renderHook(() => useComposerToolbar());

    expect(result.current[0]).toBe(true);
  });

  it("隠すとブラウザに覚え、同じ画面のほかの入力欄も追従する", () => {
    const room = renderHook(() => useComposerToolbar());
    const thread = renderHook(() => useComposerToolbar());

    act(() => room.result.current[1](false));

    expect(localStorage.getItem(COMPOSER_TOOLBAR_STORAGE_KEY)).toBe("hidden");
    expect(room.result.current[0]).toBe(false);
    expect(thread.result.current[0]).toBe(false);
  });

  it("出し直すと覚えた値を消す", () => {
    const { result } = renderHook(() => useComposerToolbar());

    act(() => result.current[1](false));
    act(() => result.current[1](true));

    expect(localStorage.getItem(COMPOSER_TOOLBAR_STORAGE_KEY)).toBeNull();
    expect(result.current[0]).toBe(true);
  });

  it("localStorage に書けなくても、この画面では切り替わる", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { result } = renderHook(() => useComposerToolbar());

    act(() => result.current[1](false));

    expect(result.current[0]).toBe(false);
  });
});
