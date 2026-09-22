import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HOVER_CLOSE_DELAY_MS, HOVER_OPEN_DELAY_MS, useHoverIntent } from "./use-hover-intent";

const mouse = { pointerType: "mouse" };

describe("useHoverIntent", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("乗せてから少したつと開く。通り過ぎただけでは開かない", () => {
    const { result } = renderHook(() => useHoverIntent());

    act(() => result.current.bind.onPointerEnter(mouse));
    act(() => vi.advanceTimersByTime(HOVER_OPEN_DELAY_MS - 1));
    act(() => result.current.bind.onPointerLeave(mouse));
    act(() => vi.advanceTimersByTime(HOVER_OPEN_DELAY_MS));
    expect(result.current.open).toBe(false);

    act(() => result.current.bind.onPointerEnter(mouse));
    act(() => vi.advanceTimersByTime(HOVER_OPEN_DELAY_MS));
    expect(result.current.open).toBe(true);
  });

  it("きっかけからカードへ移る間は閉じない", () => {
    const { result } = renderHook(() => useHoverIntent());
    act(() => result.current.bind.onPointerEnter(mouse));
    act(() => vi.advanceTimersByTime(HOVER_OPEN_DELAY_MS));

    // アバターを離れて、閉じる前にカードに乗る
    act(() => result.current.bind.onPointerLeave(mouse));
    act(() => vi.advanceTimersByTime(HOVER_CLOSE_DELAY_MS - 1));
    act(() => result.current.bind.onPointerEnter(mouse));
    act(() => vi.advanceTimersByTime(HOVER_OPEN_DELAY_MS));
    expect(result.current.open).toBe(true);

    act(() => result.current.bind.onPointerLeave(mouse));
    act(() => vi.advanceTimersByTime(HOVER_CLOSE_DELAY_MS));
    expect(result.current.open).toBe(false);
  });

  it("タッチでは開かない", () => {
    const { result } = renderHook(() => useHoverIntent());

    act(() => result.current.bind.onPointerEnter({ pointerType: "touch" }));
    act(() => vi.advanceTimersByTime(HOVER_OPEN_DELAY_MS));
    expect(result.current.open).toBe(false);
  });

  it("close はすぐに閉じ、待っていた開きも取り消す", () => {
    const { result } = renderHook(() => useHoverIntent());

    act(() => result.current.bind.onPointerEnter(mouse));
    act(() => result.current.close());
    act(() => vi.advanceTimersByTime(HOVER_OPEN_DELAY_MS));
    expect(result.current.open).toBe(false);
  });
});
