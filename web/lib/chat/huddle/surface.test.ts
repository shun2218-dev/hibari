import { describe, expect, it, vi } from "vitest";

import type { HuddleCall, HuddleCallState } from "./call";
import { createHuddleSurface } from "./surface";
import type { HuddleWindow } from "./window";

function fakeCall(initial: HuddleCallState = { phase: "idle" }) {
  let state = initial;
  const listeners = new Set<() => void>();
  const call = {
    getSnapshot: () => state,
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    openPreview: vi.fn(async (roomId: string) => {
      call.set({ phase: "preview", roomId, micOn: true, mics: [] });
    }),
    cancelPreview: vi.fn(() => call.set({ phase: "idle" })),
    dismissProblem: vi.fn(() => call.set({ phase: "idle" })),
    set(next: HuddleCallState) {
      state = next;
      for (const l of listeners) l();
    },
  };
  return call;
}

function setup({ blocked = false, mobile = false, call = fakeCall() } = {}) {
  const windows: (HuddleWindow & { closeTab(): void })[] = [];
  const surface = createHuddleSurface({
    call: call as unknown as HuddleCall,
    openWindow: (onClose) => {
      if (blocked) return null;
      const w = {
        container: document.createElement("div"),
        setTitle: vi.fn(),
        focus: vi.fn(),
        close: vi.fn(),
        // 利用者がタブを閉じた
        closeTab: () => onClose(),
      };
      windows.push(w);
      return w;
    },
    preferOverlay: () => mobile,
  });
  return { surface, call, windows };
}

const IN_CALL: HuddleCallState = {
  phase: "call",
  roomId: "r-1",
  huddleId: "h-1",
  participantId: "p-1",
  connection: "connected",
  muted: false,
  speaking: [],
  mics: [],
};

describe("ハドルの画面の出し先（ADR 0066 追記 C）", () => {
  it("始めると別のタブを開き、参加前のプレビューにする", () => {
    const t = setup();
    t.surface.start("r-1");
    expect(t.surface.getSnapshot().kind).toBe("popup");
    expect(t.call.openPreview).toHaveBeenCalledWith("r-1");
  });

  it("タブを開けない（ブロック）・モバイルでは、同じタブの全画面に出す", () => {
    for (const opts of [{ blocked: true }, { mobile: true }]) {
      const t = setup(opts);
      t.surface.start("r-1");
      expect(t.surface.getSnapshot().kind).toBe("overlay");
      expect(t.windows).toHaveLength(0);
    }
  });

  it("タブが開いていれば、開き直さずに前に出す", () => {
    const t = setup();
    t.surface.show();
    t.surface.show();
    expect(t.windows).toHaveLength(1);
    expect(t.windows[0].focus).toHaveBeenCalled();
  });

  it("通話中にヘッダーのボタンを押しても、プレビューにはせず画面を出すだけ", () => {
    const t = setup({ call: fakeCall(IN_CALL) });
    t.surface.start("r-2");
    expect(t.call.openPreview).not.toHaveBeenCalled();
    expect(t.surface.getSnapshot().kind).toBe("popup");
  });

  it("通話中にタブを閉じても抜けない（帯に戻る）", () => {
    const t = setup({ call: fakeCall(IN_CALL) });
    t.surface.show();
    t.windows[0].closeTab();
    expect(t.surface.getSnapshot().kind).toBe("none");
    expect(t.call.getSnapshot().phase).toBe("call");
  });

  it("プレビューのタブを閉じたら、キャンセルと同じ", () => {
    const t = setup();
    t.surface.start("r-1");
    t.windows[0].closeTab();
    expect(t.call.cancelPreview).toHaveBeenCalled();
  });

  it("知らせのタブを閉じたら、知らせを閉じる", () => {
    const t = setup({ call: fakeCall({ phase: "problem", roomId: "r-1", problem: "failed" }) });
    t.surface.show();
    t.windows[0].closeTab();
    expect(t.call.dismissProblem).toHaveBeenCalled();
  });

  it("通話が終わったら（抜けた・キャンセルした）、タブを閉じる", () => {
    const t = setup({ call: fakeCall(IN_CALL) });
    t.surface.show();
    t.call.set({ phase: "idle" });
    expect(t.windows[0].close).toHaveBeenCalled();
    expect(t.surface.getSnapshot().kind).toBe("none");
  });

  it("閉じたタブは「新しいウィンドウで開く」で開き直す", () => {
    const t = setup({ call: fakeCall(IN_CALL) });
    t.surface.show();
    t.windows[0].closeTab();
    t.surface.show();
    expect(t.windows).toHaveLength(2);
    expect(t.surface.getSnapshot().kind).toBe("popup");
  });
});
