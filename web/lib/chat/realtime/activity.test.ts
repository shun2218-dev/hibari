import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CHECK_INTERVAL_MS, IDLE_AFTER_MS, SETTLE_MS, createActivity } from "./activity";

function setup(options: { visible?: boolean } = {}) {
  let visible = options.visible ?? true;
  let notifyVisibility = () => {};
  let notifyInput = () => {};
  const onChange = vi.fn();
  const activity = createActivity({
    onChange,
    isVisible: () => visible,
    watchVisibility: (fn) => {
      notifyVisibility = fn;
      return () => {};
    },
    watchInput: (fn) => {
      notifyInput = fn;
      return () => {};
    },
    now: () => Date.now(),
  });
  activity.start();
  return {
    activity,
    onChange,
    setVisible(next: boolean) {
      visible = next;
      notifyVisibility();
    },
    input: () => notifyInput(),
  };
}

describe("createActivity（ADR 0049 決定 3）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("見えていて操作があったばかりなら、いまの値は true", () => {
    const { activity } = setup();

    expect(activity.current()).toBe(true);
  });

  it("タブを離れると false、戻ると true を知らせる", () => {
    const { onChange, setVisible, activity } = setup();
    activity.current(); // つないだ直後に送る（true）

    setVisible(false);
    vi.advanceTimersByTime(SETTLE_MS);
    expect(onChange).toHaveBeenLastCalledWith(false);

    setVisible(true);
    vi.advanceTimersByTime(SETTLE_MS);
    expect(onChange).toHaveBeenLastCalledWith(true);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("行き来してもすぐ戻れば送らない（1 秒待ってからまとめる）", () => {
    const { onChange, setVisible, activity } = setup();
    activity.current();

    setVisible(false);
    vi.advanceTimersByTime(SETTLE_MS / 2);
    setVisible(true);
    vi.advanceTimersByTime(SETTLE_MS * 2);

    expect(onChange).not.toHaveBeenCalled();
  });

  it("操作がないまま 10 分たつと離席にする（点検は 1 分ごと）", () => {
    const { onChange, activity } = setup();
    activity.current();

    vi.advanceTimersByTime(IDLE_AFTER_MS - CHECK_INTERVAL_MS);
    expect(onChange).not.toHaveBeenCalled();

    vi.advanceTimersByTime(CHECK_INTERVAL_MS + SETTLE_MS);
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it("操作があれば離席にならず、離席のあとの操作で戻る", () => {
    const { onChange, input, activity } = setup();
    activity.current();

    // 5 分ごとに操作していれば、ずっと見ている扱い
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(IDLE_AFTER_MS / 2);
      input();
    }
    expect(onChange).not.toHaveBeenCalled();

    vi.advanceTimersByTime(IDLE_AFTER_MS + CHECK_INTERVAL_MS + SETTLE_MS);
    expect(onChange).toHaveBeenLastCalledWith(false);

    input();
    vi.advanceTimersByTime(SETTLE_MS);
    expect(onChange).toHaveBeenLastCalledWith(true);
  });

  it("見えていなければ、操作があっても見ている扱いにしない", () => {
    const { onChange, input, activity } = setup({ visible: false });

    expect(activity.current()).toBe(false);
    input();
    vi.advanceTimersByTime(SETTLE_MS * 2);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("stop のあとは知らせない（タイマーも購読も残さない）", () => {
    const { onChange, setVisible, activity } = setup();
    activity.current();

    activity.stop();
    setVisible(false);
    vi.advanceTimersByTime(IDLE_AFTER_MS * 2);

    expect(onChange).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("再接続では、知らせ済みの値を忘れる（サーバー側の接続はまた「見ていない」から始まる）", () => {
    const { activity } = setup();
    activity.current();

    activity.reset();

    // 忘れているので、同じ true をもう一度送れる
    expect(activity.current()).toBe(true);
  });
});
