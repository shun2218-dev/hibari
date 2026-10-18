import { describe, expect, it, vi } from "vitest";

import type { NotificationContent } from "./desktop-notification";
import { type DesktopNotifierOptions, type NotifierChannel, type VisibilityMessage, createDesktopNotifier } from "./desktop-notifier";

const content: NotificationContent = { title: "高橋 みゆき（#雑談）", body: "こんにちは", tag: "m-1", url: "/w/ws-1/r/r1?m=m-1" };

/** 同じオリジンのタブ同士の BroadcastChannel（自分の送ったものは自分に届かない）。 */
function channelHub() {
  const members = new Set<{ listener?: (e: { data: VisibilityMessage }) => void }>();
  return () => {
    const self: { listener?: (e: { data: VisibilityMessage }) => void } = {};
    members.add(self);
    const channel: NotifierChannel = {
      postMessage(data) {
        for (const m of members) if (m !== self) m.listener?.({ data });
      },
      addEventListener(_type, listener) {
        self.listener = listener;
      },
      close() {
        members.delete(self);
      },
    };
    return channel;
  };
}

/** Web Locks の偽物。先に頼んだタブが持ち、持っていたタブが手放すと次のタブに渡る。 */
function fakeLocks() {
  const queue: (() => Promise<void>)[] = [];
  let held = false;
  function next() {
    const run = queue.shift();
    if (!run) return;
    held = true;
    void run().then(() => {
      held = false;
      next();
    });
  }
  return {
    request(_name: string, callback: () => Promise<void>) {
      queue.push(callback);
      if (!held) next();
      return Promise.resolve();
    },
  };
}

function tab(overrides: Partial<DesktopNotifierOptions> & { tabId: string }) {
  let visible = false;
  const visibilityListeners = new Set<() => void>();
  const show = vi.fn((_c: NotificationContent, onClick: () => void) => onClick);
  const playSound = vi.fn();
  const open = vi.fn();
  const notifier = createDesktopNotifier({
    permission: () => "granted",
    show,
    visible: () => visible,
    onVisibilityChange: (l) => {
      visibilityListeners.add(l);
      return () => visibilityListeners.delete(l);
    },
    playSound,
    soundEnabled: () => true,
    open,
    ...overrides,
  });
  return {
    notifier,
    show,
    playSound,
    open,
    setVisible(v: boolean) {
      visible = v;
      for (const l of visibilityListeners) l();
    },
  };
}

describe("createDesktopNotifier（ADR 0057 決定 2）", () => {
  it("ロックを持つタブだけが出し、閉じられたら次のタブが引き継ぐ", async () => {
    const locks = fakeLocks();
    const hub = channelHub();
    const a = tab({ tabId: "a", locks, createChannel: hub });
    const b = tab({ tabId: "b", locks, createChannel: hub });
    a.notifier.start();
    b.notifier.start();
    await Promise.resolve();

    expect(a.notifier.notify(content)).toBe(true);
    expect(b.notifier.notify(content)).toBe(false);

    a.notifier.stop();
    await Promise.resolve();
    await Promise.resolve();
    expect(b.notifier.notify(content)).toBe(true);
  });

  it("どれかのタブが見えていれば出さない（見え方は知らせ合う）", async () => {
    const locks = fakeLocks();
    const hub = channelHub();
    const a = tab({ tabId: "a", locks, createChannel: hub });
    const b = tab({ tabId: "b", locks, createChannel: hub });
    a.notifier.start();
    b.notifier.start();
    await Promise.resolve();

    b.setVisible(true);
    expect(a.notifier.notify(content)).toBe(false);
    b.setVisible(false);
    expect(a.notifier.notify(content)).toBe(true);
    a.setVisible(true);
    expect(a.notifier.notify(content)).toBe(false);
  });

  it("後から開いたタブも、先にいたタブの見え方を知る", async () => {
    const locks = fakeLocks();
    const hub = channelHub();
    const a = tab({ tabId: "a", locks, createChannel: hub });
    a.notifier.start();
    await Promise.resolve();
    // b は見えている状態で開き、hello に a が返事をする。a は b の見え方を hello で知る
    const b = tab({ tabId: "b", locks, createChannel: hub });
    b.setVisible(true);
    b.notifier.start();

    expect(a.notifier.notify(content)).toBe(false);
    b.notifier.stop();
    expect(a.notifier.notify(content)).toBe(true);
  });

  it("止めてからもう一度始めても動く（Strict Mode の start → stop → start）", async () => {
    const locks = fakeLocks();
    const hub = channelHub();
    const a = tab({ tabId: "a", locks, createChannel: hub });
    const b = tab({ tabId: "b", locks, createChannel: hub });
    a.notifier.start();
    a.notifier.stop();
    a.notifier.start();
    b.notifier.start();
    await Promise.resolve();
    await Promise.resolve();

    b.setVisible(true);
    expect(a.notifier.notify(content)).toBe(false);
    b.setVisible(false);
    expect(a.notifier.notify(content)).toBe(true);
  });

  it("許可されていなければ出そうとしない", async () => {
    const a = tab({ tabId: "a", permission: () => "denied" });
    a.notifier.start();

    expect(a.notifier.notify(content)).toBe(false);
    expect(a.show).not.toHaveBeenCalled();
  });

  it("出したら音を鳴らし（切っていれば鳴らさない）、押されたらそのメッセージを開く", () => {
    const a = tab({ tabId: "a" });
    a.notifier.start();

    a.notifier.notify(content);
    expect(a.playSound).toHaveBeenCalledOnce();
    const onClick = a.show.mock.calls[0][1];
    onClick();
    expect(a.open).toHaveBeenCalledWith("/w/ws-1/r/r1?m=m-1");

    const quiet = tab({ tabId: "q", soundEnabled: () => false });
    quiet.notifier.start();
    quiet.notifier.notify(content);
    expect(quiet.playSound).not.toHaveBeenCalled();
  });

  it("Web Locks がなければ、見えていないそのタブが出す（止めた後は出さない）", () => {
    const a = tab({ tabId: "a" });
    a.notifier.start();
    expect(a.notifier.notify(content)).toBe(true);

    a.notifier.stop();
    expect(a.notifier.notify(content)).toBe(false);
  });
});
