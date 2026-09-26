import type { AudioSink, CallEnv, LevelMeter } from "./call";

/**
 * 通話（call.ts）に渡す、本物のブラウザの API。テストは偽物を渡すので、ここはブラウザでしか動かさない。
 */

export const MIC_KEY = "hibari:huddle-mic";
export const SPEAKER_KEY = "hibari:huddle-speaker";

/** WebRTC が使えるブラウザか。使えなければハドルのボタンを出さない。 */
export function callSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.RTCPeerConnection === "function" &&
    typeof navigator.mediaDevices?.getUserMedia === "function"
  );
}

export function browserCallEnv(
  base: Pick<CallEnv, "api" | "userId" | "heartbeat" | "setCallRoom">,
): CallEnv {
  let audioContext: AudioContext | undefined;
  // 受けた音声の再生は、チャットのタブ（通話を持つタブ）でする。ハドルのタブを閉じても音が途切れないように（追記 C）
  const canSelectSpeaker = typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;

  function context(): AudioContext {
    audioContext ??= new AudioContext();
    // 自動再生の制限で止まっていることがある。参加のボタンを押した後なので再開できる
    if (audioContext.state === "suspended") void audioContext.resume();
    return audioContext;
  }

  return {
    ...base,
    getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
    enumerateDevices: () => navigator.mediaDevices.enumerateDevices(),
    createPeerConnection: (config) => new RTCPeerConnection({ ...config, bundlePolicy: "max-bundle" }),
    canSelectSpeaker,
    playAudio(stream, speakerId): AudioSink {
      const audio = new Audio();
      audio.autoplay = true;
      audio.srcObject = stream;
      const setSpeaker = (id: string | undefined) => {
        if (canSelectSpeaker && id) void audio.setSinkId(id).catch(() => {});
      };
      setSpeaker(speakerId);
      void audio.play().catch(() => {});
      return {
        setSpeaker,
        detach() {
          audio.pause();
          audio.srcObject = null;
        },
      };
    },
    meter(stream): LevelMeter {
      const ctx = context();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const buffer = new Float32Array(analyser.fftSize);
      return {
        level() {
          analyser.getFloatTimeDomainData(buffer);
          let sum = 0;
          for (const v of buffer) sum += v * v;
          return Math.sqrt(sum / buffer.length);
        },
        stop() {
          source.disconnect();
        },
      };
    },
    prefs: {
      mic: () => read(MIC_KEY),
      setMic: (id) => write(MIC_KEY, id),
      speaker: () => read(SPEAKER_KEY),
      setSpeaker: (id) => write(SPEAKER_KEY, id),
    },
    setInterval: (fn, ms) => window.setInterval(fn, ms),
    clearInterval: (id) => window.clearInterval(id as number | undefined),
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (id) => window.clearTimeout(id as number | undefined),
    now: Date.now,
  };
}

// 選んだ機器は端末ごとに覚える（追記 B）。読み書きに失敗したら「覚えていない」と同じに扱う
function read(key: string): string | undefined {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 覚えられないだけで、この通話では反映する
  }
}
