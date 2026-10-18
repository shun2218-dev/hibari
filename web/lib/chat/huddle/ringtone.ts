/**
 * DM のハドルの呼び出し音（ADR 0066 決定 11）。呼び出しを出している間、2 秒ごとに短い 2 音を繰り返す。
 * 音の素材は持たず、Web Audio で作る（通知音の createChime と同じ）。
 *
 * 自動再生の制限で、このタブで一度も操作がなければ鳴らない（ブラウザが止める）。呼び出しの表示は出るので、それでよしとする。
 */

/** 繰り返しの間隔。 */
export const RING_INTERVAL_MS = 2_000;

export function createRingtone(): { start(): void; stop(): void; unlock(): void } {
  let context: AudioContext | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;

  function ensure(): AudioContext | undefined {
    if (context) return context;
    const Ctor = typeof window === "undefined" ? undefined : window.AudioContext;
    if (!Ctor) return undefined;
    context = new Ctor();
    return context;
  }

  function ring() {
    const ctx = ensure();
    if (!ctx || ctx.state !== "running") return;
    const now = ctx.currentTime;
    // 同じ高さの音を 2 回。通知音（上がる 2 音）と聞き分けられるようにする
    for (const offset of [0, 0.35]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 660;
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.18, now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.32);
    }
  }

  return {
    unlock() {
      void ensure()?.resume().catch(() => {});
    },
    start() {
      if (timer !== undefined) return;
      ring();
      timer = setInterval(ring, RING_INTERVAL_MS);
    },
    stop() {
      clearInterval(timer);
      timer = undefined;
    },
  };
}
