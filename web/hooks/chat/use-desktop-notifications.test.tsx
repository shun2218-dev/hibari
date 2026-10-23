import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BANNER_DISMISSED_KEY } from "@/lib/chat/notifications/notification-prefs";
import type { BrowserPushState, WebPush } from "@/lib/chat/notifications/web-push";
import { ChatContext, type ChatContextValue } from "@/providers/chat-provider";

import { useDesktopNotifications } from "./use-desktop-notifications";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

function fakePush(initial: BrowserPushState) {
  let current = initial;
  const listeners = new Set<() => void>();
  const push = {
    state: vi.fn(() => Promise.resolve(current)),
    enable: vi.fn(() => {
      current = "on";
      return Promise.resolve<BrowserPushState>("on");
    }),
    subscribe: vi.fn((listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }),
  };
  return {
    push: push as unknown as WebPush & typeof push,
    /** resync や設定で状態が変わったときと同じに知らせる。 */
    change(next: BrowserPushState) {
      current = next;
      for (const listener of listeners) listener();
    },
  };
}

function Banner() {
  return <>{useDesktopNotifications()}</>;
}

function renderBanner(push: WebPush | null) {
  const value = { desktop: null, push } as unknown as ChatContextValue;
  const wrapper = ({ children }: { children: ReactNode }) => <ChatContext value={value}>{children}</ChatContext>;
  return render(<Banner />, { wrapper });
}

/** null は Notification のないブラウザ（iPhone の Safari でホーム画面にない）。 */
function setPermission(permission: NotificationPermission | null) {
  const requestPermission = vi.fn(() => Promise.resolve<NotificationPermission>("granted"));
  if (permission === null) {
    // "Notification" in window で見るので、undefined を入れるのではなく消す
    const original = Object.getOwnPropertyDescriptor(window, "Notification");
    delete (window as { Notification?: unknown }).Notification;
    restores.push(() => {
      if (original) Object.defineProperty(window, "Notification", original);
    });
    return requestPermission;
  }
  vi.stubGlobal("Notification", { permission, requestPermission });
  return requestPermission;
}

const restores: (() => void)[] = [];

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const restore of restores.splice(0)) restore();
});

describe("useDesktopNotifications のサイドバーの帯（ADR 0069）", () => {
  it.each([
    ["off", "default", "通知を有効にしますか？"],
    ["install", null, "ホーム画面に追加すると通知が届きます"],
    ["server-disabled", "default", "デスクトップ通知を有効にしますか？"],
    ["unsupported", "default", "デスクトップ通知を有効にしますか？"],
  ] as const)("プッシュ %s・許可 %s では「%s」の帯", async (state, permission, title) => {
    setPermission(permission);
    renderBanner(fakePush(state).push);
    expect(await screen.findByText(title)).toBeInTheDocument();
  });

  it.each([
    ["on", "granted"],
    ["denied", "denied"],
    ["off", "granted"],
  ] as const)("プッシュ %s・許可 %s では帯を出さない", async (state, permission) => {
    setPermission(permission);
    const { push } = fakePush(state);
    renderBanner(push);
    await act(() => Promise.resolve());
    expect(push.state).toHaveBeenCalled();
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("プッシュの状態を読み終わるまでは、どの帯も出さない（文言が途中で替わらないように）", () => {
    setPermission("default");
    const push = { state: () => new Promise(() => {}), subscribe: () => () => {} } as unknown as WebPush;
    renderBanner(push);
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("プッシュを読めない（偽のソケットのテスト・サーバーでの描画）ときは、6.14b のデスクトップ通知の帯", () => {
    setPermission("default");
    renderBanner(null);
    expect(screen.getByText("デスクトップ通知を有効にしますか？")).toBeInTheDocument();
  });

  it("「有効にする」は、押した操作の中で（await を挟まずに）push.enable を呼び、有効になったら帯を消す", async () => {
    setPermission("default");
    const { push } = fakePush("off");
    renderBanner(push);
    const button = await screen.findByRole("button", { name: "有効にする" });

    // click の処理が返った時点で、もう呼ばれている（Safari は await の後の許可の要求を拒む）
    act(() => button.click());
    expect(push.enable).toHaveBeenCalledOnce();

    await vi.waitFor(() => expect(screen.queryByRole("region")).toBeNull());
  });

  it("「有効にする」が失敗しても、状態を読み直す（失敗は設定の「通知」に出し、帯には出さない）", async () => {
    setPermission("default");
    const { push } = fakePush("off");
    push.enable.mockImplementationOnce(() => Promise.reject(new Error("boom")));
    renderBanner(push);
    await userEvent.click(await screen.findByRole("button", { name: "有効にする" }));
    await vi.waitFor(() => expect(push.state).toHaveBeenCalledTimes(2));
  });

  it("デスクトップの帯の「有効にする」は、これまでどおり許可だけを求める", async () => {
    const requestPermission = setPermission("default");
    const { push } = fakePush("server-disabled");
    renderBanner(push);
    await userEvent.click(await screen.findByRole("button", { name: "有効にする" }));
    expect(requestPermission).toHaveBeenCalledOnce();
    expect(push.enable).not.toHaveBeenCalled();
  });

  it("resync などで状態が変わったら読み直す", async () => {
    setPermission("default");
    const { push, change } = fakePush("off");
    renderBanner(push);
    await screen.findByText("通知を有効にしますか？");
    act(() => change("on"));
    await vi.waitFor(() => expect(screen.queryByRole("region")).toBeNull());
  });

  it.each([
    ["off", "default"],
    ["install", null],
    ["server-disabled", "default"],
  ] as const)("「今はしない」で閉じたら、その端末では出さない（プッシュ %s）", async (state, permission) => {
    setPermission(permission);
    const first = renderBanner(fakePush(state).push);
    await userEvent.click(await screen.findByRole("button", { name: "今はしない" }));
    expect(screen.queryByRole("region")).toBeNull();
    expect(localStorage.getItem(BANNER_DISMISSED_KEY)).toBe("1");

    // 開き直しても出さない。種類によらず 1 つの印（帯は 1 つ。決定 2）
    first.unmount();
    setPermission("default");
    const { push } = fakePush("off");
    renderBanner(push);
    await act(() => Promise.resolve());
    expect(push.state).toHaveBeenCalled();
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("「追加のしかた」でホーム画面に追加する手順を開き、「閉じる」で閉じてボタンにフォーカスを戻す", async () => {
    setPermission(null);
    renderBanner(fakePush("install").push);
    const open = await screen.findByRole("button", { name: "追加のしかた" });

    await userEvent.click(open);
    const sheet = screen.getByRole("dialog", { name: "ホーム画面に追加する" });
    expect(sheet).toHaveFocus();

    await userEvent.click(screen.getByRole("button", { name: "閉じる" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(open).toHaveFocus();
    // シートを閉じても帯は残る（「今はしない」ではない）
    expect(screen.getByText("ホーム画面に追加すると通知が届きます")).toBeInTheDocument();
  });
});
