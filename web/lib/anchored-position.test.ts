import { describe, expect, it } from "vitest";

import { placePanel } from "./anchored-position";

const viewport = { width: 1280, height: 800 };
const panel = { width: 352, height: 440 };

describe("placePanel", () => {
  it("下に入るときは、行の上端から下に開く", () => {
    const got = placePanel({ top: 100, bottom: 140, right: 1200 }, panel, viewport);

    expect(got).toEqual({ top: 124, left: 1200 - 16 - 352, below: true });
  });

  it("下に入りきらなければ、行の下端から上に開く", () => {
    // 上端から開くと 700 + 440 = 1140 で、画面（800）に収まらない
    const got = placePanel({ top: 700, bottom: 740, right: 1200 }, panel, viewport);

    expect(got.below).toBe(false);
    expect(got.top).toBe(740 - 24 - 440);
  });

  it("上に開いても画面から出るときは、上端に寄せる", () => {
    // 行が画面の上の方にあって、かつ下にも入らない（画面が低い）
    const got = placePanel({ top: 40, bottom: 80, right: 1200 }, panel, { width: 1280, height: 420 });

    expect(got.top).toBe(8);
  });

  it("左に寄った行でも、画面の左からはみ出さない", () => {
    const got = placePanel({ top: 100, bottom: 140, right: 200 }, panel, viewport);

    expect(got.left).toBe(8);
  });

  it("右に寄りすぎないよう、画面の右にも余白を残す", () => {
    const got = placePanel({ top: 100, bottom: 140, right: 1400 }, panel, viewport);

    expect(got.left).toBe(1280 - 8 - 352);
  });

  it("画面よりパネルが高ければ、上端に貼り付ける（中身が自分でスクロールする）", () => {
    const got = placePanel({ top: 100, bottom: 140, right: 1200 }, { width: 352, height: 900 }, viewport);

    expect(got.top).toBe(8);
  });
});
