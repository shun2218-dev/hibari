import { describe, expect, it } from "vitest";

import { placeBeside, placePanel } from "./anchored-position";

const viewport = { width: 1280, height: 800 };
const panel = { width: 352, height: 440 };

describe("placePanel", () => {
  it("下に入るときは、行の上端から下に開く", () => {
    const got = placePanel({ top: 100, bottom: 140, left: 1000, right: 1200 }, panel, viewport);

    expect(got).toEqual({ top: 124, left: 1200 - 16 - 352, below: true });
  });

  it("下に入りきらなければ、行の下端から上に開く", () => {
    // 上端から開くと 700 + 440 = 1140 で、画面（800）に収まらない
    const got = placePanel({ top: 700, bottom: 740, left: 1000, right: 1200 }, panel, viewport);

    expect(got.below).toBe(false);
    expect(got.top).toBe(740 - 24 - 440);
  });

  it("上に開いても画面から出るときは、上端に寄せる", () => {
    // 行が画面の上の方にあって、かつ下にも入らない（画面が低い）
    const got = placePanel({ top: 40, bottom: 80, left: 1000, right: 1200 }, panel, { width: 1280, height: 420 });

    expect(got.top).toBe(8);
  });

  it("左に寄った行でも、画面の左からはみ出さない", () => {
    const got = placePanel({ top: 100, bottom: 140, left: 160, right: 200 }, panel, viewport);

    expect(got.left).toBe(8);
  });

  it("右に寄りすぎないよう、画面の右にも余白を残す", () => {
    const got = placePanel({ top: 100, bottom: 140, left: 1360, right: 1400 }, panel, viewport);

    expect(got.left).toBe(1280 - 8 - 352);
  });

  it("画面よりパネルが高ければ、上端に貼り付ける（中身が自分でスクロールする）", () => {
    const got = placePanel({ top: 100, bottom: 140, left: 1000, right: 1200 }, { width: 352, height: 900 }, viewport);

    expect(got.top).toBe(8);
  });

  // ボタンのような狭いアンカーは、左端に合わせる（ADR 0049 のステータスの絵文字のボタン）
  it("start なら、アンカーの左端に合わせる", () => {
    const got = placePanel({ top: 100, bottom: 140, left: 440, right: 484 }, panel, viewport, "start");

    expect(got.left).toBe(440);
  });

  it("start でも、画面の右からはみ出さない", () => {
    const got = placePanel({ top: 100, bottom: 140, left: 1200, right: 1244 }, panel, viewport, "start");

    expect(got.left).toBe(1280 - 8 - 352);
  });
});

describe("placeBeside", () => {
  const card = { width: 320, height: 360 };

  it("右に入るときは、アンカーの右に上端をそろえて開く", () => {
    const got = placeBeside({ top: 200, bottom: 240, left: 300, right: 340 }, card, viewport);

    expect(got).toEqual({ top: 200, left: 348, below: true });
  });

  it("右に入らなければ、アンカーの左に開く（右端のメンバーパネル）", () => {
    const got = placeBeside({ top: 200, bottom: 240, left: 1000, right: 1260 }, card, viewport);

    expect(got.left).toBe(1000 - 8 - 320);
  });

  it("下からはみ出すときは、画面の中まで持ち上げる", () => {
    const got = placeBeside({ top: 700, bottom: 740, left: 300, right: 340 }, card, viewport);

    expect(got.top).toBe(800 - 8 - 360);
    expect(got.below).toBe(false);
  });

  it("左右どちらにも入らなければ、画面の左端に寄せる", () => {
    const got = placeBeside({ top: 200, bottom: 240, left: 100, right: 1200 }, card, viewport);

    expect(got.left).toBe(8);
  });
});
