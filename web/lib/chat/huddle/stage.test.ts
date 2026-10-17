import { describe, expect, it } from "vitest";

import { chooseStage, EMPTY_STAGE, STAGE_HOLD_MS, type StageInput, type StageMemory } from "./stage";

const people = (n: number, camera = true) =>
  Array.from({ length: n }, (_, i) => ({ userId: `u${i + 1}`, camera, screen: false }));

function input(overrides: Partial<StageInput> = {}): StageInput {
  return { selfId: "me", selfCamera: false, others: people(3), speaking: [], visible: true, mobile: false, now: 0, ...overrides };
}

const cameras = (r: ReturnType<typeof chooseStage>) => r.tracks.filter((t) => t.kind === "camera").map((t) => t.userId);

describe("chooseStage（ADR 0068 決定 5・6）", () => {
  it("帯だけのとき（画面が見えていない）は、映像を 1 本も受けない", () => {
    expect(chooseStage(input({ visible: false })).tracks).toEqual([]);
  });

  it("カメラを付けている人だけを載せ、付けていない人は受けない", () => {
    const r = chooseStage(input({ others: [...people(2), { userId: "u9", camera: false, screen: false }] }));
    expect(cameras(r)).toEqual(["u1", "u2"]);
  });

  it.each([
    { name: "デスクトップは 9（自分を除いて 8）", over: {}, want: 8 },
    { name: "自分がカメラを付けていなければ 9", over: { selfCamera: false }, want: 9 },
    { name: "モバイルは 4（自分を除いて 3）", over: { mobile: true }, want: 3 },
  ])("ステージの数: $name", ({ over, want }) => {
    const r = chooseStage(input({ others: people(19), selfCamera: true, ...over }));
    expect(cameras(r)).toHaveLength(want);
  });

  it("画面共有があれば、共有を全部受け、カメラは 4（自分を除いて 3）を下の列の low で受ける", () => {
    const others = people(6).map((p, i) => ({ ...p, screen: i < 2 }));
    const r = chooseStage(input({ others, selfCamera: true }));
    expect(r.tracks.filter((t) => t.kind === "screen").map((t) => t.userId)).toEqual(["u1", "u2"]);
    expect(r.tracks.filter((t) => t.kind === "camera")).toHaveLength(3);
    expect(r.tracks.filter((t) => t.kind === "camera").every((t) => t.quality === "low")).toBe(true);
  });

  it.each([
    { count: 1, quality: "high" },
    { count: 3, quality: "medium" },
    { count: 6, quality: "low" },
  ])("グリッドの層はタイルの大きさで選ぶ（自分を入れて $count 人 → $quality）", ({ count, quality }) => {
    const r = chooseStage(input({ others: people(count) }));
    expect(new Set(r.tracks.map((t) => t.quality))).toEqual(new Set([quality]));
  });

  it("押して大きくした人を先に載せて high、ほかは low", () => {
    const r = chooseStage(input({ others: people(12), pinnedId: "u12" }));
    expect(cameras(r)[0]).toBe("u12");
    expect(r.tracks.find((t) => t.userId === "u12")?.quality).toBe("high");
    expect(r.tracks.filter((t) => t.userId !== "u12").every((t) => t.quality === "low")).toBe(true);
  });

  it("最近話した人を先に載せる。満員のときの入れ替えは STAGE_HOLD_MS に 1 回まで", () => {
    const others = people(12);
    let r = chooseStage(input({ others, now: 0 }));
    expect(cameras(r)).toEqual(["u1", "u2", "u3", "u4", "u5", "u6", "u7", "u8", "u9"]);

    // u12 が話した。直後なので入れ替えないが、話した時刻は覚える
    r = chooseStage(input({ others, speaking: ["u12"], now: 1_000 }), withChange(r.memory, 0));
    expect(cameras(r)).not.toContain("u12");

    // 間隔が空いたら、話した順で入れ替える（いちばん長く話していない人が外れる）
    r = chooseStage(input({ others, now: 1_000 + STAGE_HOLD_MS }), r.memory);
    expect(cameras(r)).toContain("u12");
    expect(cameras(r)).toHaveLength(9);
    const swappedAt = r.memory.changedAt;

    // 入れ替えた直後に別の人が話しても、すぐには入れ替えない
    r = chooseStage(input({ others, speaking: ["u11"], now: swappedAt + 1 }), r.memory);
    expect(cameras(r)).not.toContain("u11");
  });

  it("カメラを消した・抜けた人の枠は、間隔を待たずに埋める", () => {
    const others = people(12);
    let r = chooseStage(input({ others, now: 0 }));
    r = chooseStage(input({ others, now: 1 }), withChange(r.memory, 1));
    const off = others.map((p) => (p.userId === "u3" ? { ...p, camera: false } : p));
    r = chooseStage(input({ others: off, now: 2 }), r.memory);
    expect(cameras(r)).not.toContain("u3");
    expect(cameras(r)).toHaveLength(9);
  });

  it("押して大きくした人は、間隔を待たずに載せる", () => {
    const others = people(12);
    let r = chooseStage(input({ others, now: 0 }));
    r = chooseStage(input({ others, pinnedId: "u12", now: 1 }), withChange(r.memory, 1));
    expect(cameras(r)).toContain("u12");
  });
});

/** 直前に話した順で入れ替えたことにする（入れ替えの間隔を試すため）。 */
function withChange(memory: StageMemory, at: number): StageMemory {
  return { ...(memory ?? EMPTY_STAGE), changedAt: at };
}
