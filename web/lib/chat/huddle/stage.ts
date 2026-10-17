import type { HuddleQuality } from "@/lib/api/types.gen";

/**
 * ステージ（ADR 0068 決定 5・6）: ハドルの画面で映像を映すタイルの枠。受ける映像は、ステージに載せた分だけにする。
 *
 * 費用（Cloudflare の送り出す量）は「受ける人 × 受ける本数」で決まるので、見えない映像は受けない。
 * 載せる順は、押して大きくした人（ピン留め）・最近話した人・入った順。自分の映像は手元のカメラを映すので、受ける本数に数えない。
 * 話すたびに入れ替えるとタイルがちらつき、SDP のやり取りも増えるので、話した順による入れ替えは STAGE_HOLD_MS に 1 回までにする。
 */

/** ステージの数（オーナーの確認 3）。デスクトップは 9、画面共有があるときは共有と 4、モバイルは 4。自分の分を含む。 */
export const STAGE_SIZE = { desktop: 9, sharing: 4, mobile: 4 } as const;

/** 話した順による入れ替えの間隔。 */
export const STAGE_HOLD_MS = 5_000;

export type StageInput = {
  selfId: string;
  /** 自分がカメラを付けている（自分の枠を 1 つ使う）。 */
  selfCamera: boolean;
  /** いま入っている人（自分を除く。入った順）。 */
  others: readonly { userId: string; camera: boolean; screen: boolean }[];
  /** 押して大きくした人（user id）か共有（`screen:<user id>`）。 */
  pinnedId?: string;
  /** 話している人（user id）。 */
  speaking: readonly string[];
  /** ハドルの画面が見えている（別のタブか全画面）。帯だけのときは映像を 1 本も受けない（決定 5）。 */
  visible: boolean;
  mobile: boolean;
  now: number;
};

/** 受ける映像 1 本。 */
export type StageTrack = { userId: string; kind: "camera" | "screen"; quality?: HuddleQuality };

/** 前回の選び方。話した順による入れ替えを抑えるために持ち回す。 */
export type StageMemory = {
  /** ステージに載っている人（自分を除く）。 */
  cameras: readonly string[];
  /** 最後に話した時刻（user id ごと）。 */
  spokeAt: Readonly<Record<string, number>>;
  /** 話した順で入れ替えた時刻。 */
  changedAt: number;
};

export const EMPTY_STAGE: StageMemory = { cameras: [], spokeAt: {}, changedAt: -Infinity };

/** 受ける映像と、次に渡す覚え書きを返す。 */
export function chooseStage(input: StageInput, memory: StageMemory = EMPTY_STAGE): { tracks: StageTrack[]; memory: StageMemory } {
  const spokeAt = { ...memory.spokeAt };
  for (const id of input.speaking) spokeAt[id] = input.now;
  if (!input.visible) return { tracks: [], memory: { ...memory, cameras: [], spokeAt } };

  const screens = input.others.filter((p) => p.screen).map((p) => p.userId);
  const sharing = screens.length > 0 || input.pinnedId?.startsWith("screen:") === true;
  const size = input.mobile ? STAGE_SIZE.mobile : sharing ? STAGE_SIZE.sharing : STAGE_SIZE.desktop;
  const slots = Math.max(0, size - (input.selfCamera ? 1 : 0));

  const withCamera = input.others.filter((p) => p.camera).map((p) => p.userId);
  const pinned = withCamera.find((id) => id === input.pinnedId);
  const joinOrder = new Map(withCamera.map((id, i) => [id, i]));
  // 載せる順: ピン留め → 最近話した人 → 入った順
  const ranked = [...withCamera].sort((a, b) => {
    if (a === pinned) return -1;
    if (b === pinned) return 1;
    const spoke = (spokeAt[b] ?? -Infinity) - (spokeAt[a] ?? -Infinity);
    return spoke !== 0 ? spoke : (joinOrder.get(a) ?? 0) - (joinOrder.get(b) ?? 0);
  });
  const desired = ranked.slice(0, slots);

  // 前回のステージで、まだカメラを付けている人。この人たちを話した順だけで外すのは、間隔を空けてから
  const kept = memory.cameras.filter((id) => withCamera.includes(id));
  const forced =
    pinned !== undefined && !kept.includes(pinned) ? true : kept.length > slots || memory.cameras.length !== kept.length;
  let cameras: string[];
  let changedAt = memory.changedAt;
  if (sameSet(desired, kept)) {
    cameras = kept;
  } else if (forced || input.now - memory.changedAt >= STAGE_HOLD_MS || kept.length < Math.min(slots, withCamera.length)) {
    // 入れ替える: 抜けた・消した・ピン留めが変わった・枠が空いた、または前回から間隔が空いた
    cameras = desired;
    if (!forced && kept.length >= Math.min(slots, withCamera.length)) changedAt = input.now;
  } else {
    cameras = kept;
  }

  const quality = cameraQuality({ count: input.others.length + 1, pinned, sharing });
  const tracks: StageTrack[] = [
    ...cameras.map((userId) => ({ userId, kind: "camera" as const, quality: quality(userId) })),
    // 共有された画面は、2 つまでなので全部受ける（決定 7）
    ...screens.map((userId) => ({ userId, kind: "screen" as const })),
  ];
  return { tracks, memory: { cameras, spokeAt, changedAt } };
}

/**
 * カメラの層をタイルの大きさで選ぶ（ADR 0068 決定 6）。
 * 押して大きくした人は high。共有や押して大きくした人がいれば、ほかは下の列なので low。
 * グリッドは、人数が 2 人まで high、4 人まで medium、それより多ければ low。
 */
function cameraQuality({ count, pinned, sharing }: { count: number; pinned?: string; sharing: boolean }) {
  return (userId: string): HuddleQuality => {
    if (pinned === userId) return "high";
    if (pinned !== undefined || sharing) return "low";
    if (count <= 2) return "high";
    if (count <= 4) return "medium";
    return "low";
  };
}

function sameSet(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((id) => b.includes(id));
}
