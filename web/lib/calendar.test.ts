import { describe, expect, it } from "vitest";

import { dateLabel, fromISODate, halfHourTimes, monthGrid, monthLabel, shiftDate, shiftMonth, toISODate } from "./calendar";

describe("カレンダーの日付の計算（ADR 0049 の追記）", () => {
  it("ローカルの日付として往復する（UTC でずらさない）", () => {
    // UTC で作ると、日本時間では前日になる日
    expect(toISODate(new Date(2026, 8, 1))).toBe("2026-09-01");
    expect(fromISODate("2026-09-01")?.getDate()).toBe(1);
  });

  it("存在しない日は undefined", () => {
    expect(fromISODate("2026-02-31")).toBeUndefined();
    expect(fromISODate("2026-9-1")).toBeUndefined();
  });

  it("月をまたいで送れる", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });

  it("日をまたいで送れる（うるう年も）", () => {
    expect(shiftDate("2026-09-30", 1)).toBe("2026-10-01");
    expect(shiftDate("2028-02-28", 1)).toBe("2028-02-29");
    expect(shiftDate("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("マス目は 6 週ぶんで、日曜から始まる", () => {
    const grid = monthGrid("2026-09");

    expect(grid).toHaveLength(6);
    expect(grid.every((week) => week.length === 7)).toBe(true);
    // 2026-09-01 は火曜なので、1 週目は日月が空く
    expect(grid[0].slice(0, 3)).toEqual([undefined, undefined, "2026-09-01"]);
    expect(grid.flat().filter(Boolean)).toHaveLength(30);
  });

  it("見出しと読み上げの文言", () => {
    expect(monthLabel("2026-09")).toBe("2026年9月");
    expect(dateLabel("2026-09-25")).toBe("2026年9月25日（金）");
  });

  it("時刻は 30 分刻みで 48 個（Slack と同じ）", () => {
    const times = halfHourTimes();

    expect(times).toHaveLength(48);
    expect(times[0]).toBe("00:00");
    expect(times[1]).toBe("00:30");
    expect(times.at(-1)).toBe("23:30");
  });
});
