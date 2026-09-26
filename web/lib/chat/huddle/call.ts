import type { HuddleLeftData, HuddleICEServers } from "@/lib/api/types.gen";
import { ApiError } from "@/lib/api/error";
import type { ChatApi } from "@/lib/chat/api/chat-api";

/**
 * ハドルの通話（ADR 0066）。マイク・RTCPeerConnection・心拍・話している人の判定を持つ。
 *
 * 通話はチャットのタブが持つ（追記 C）。ハドルのタブ（about:blank）は画面を映すだけで、この状態を読んで描く。
 * 音声はブラウザと Cloudflare の間を直接流れ、Go のサーバーが受け持つのは SDP の中継だけ（決定 2）。
 *
 * ブラウザの API（getUserMedia・RTCPeerConnection・音の出力・音量の測定）は外から渡す。テストで偽物に差し替えるため。
 */

/** 心拍の間隔（決定 5）。サーバーの期限（30 秒）の間に 2 回は届くようにする。 */
export const HEARTBEAT_INTERVAL_MS = 10_000;
/** ICE の候補を集め終わるのを待つ上限。Cloudflare の SFU は候補を後から足せないので、集め終わってから offer を送る。 */
export const ICE_GATHERING_TIMEOUT_MS = 2_000;
/** TURN の認証情報を、期限のこれだけ前に取り直す（決定 14）。 */
export const ICE_REFRESH_BEFORE_MS = 10 * 60_000;
/** 話している人を測り直す間隔（決定 10）。 */
export const SPEAKING_POLL_MS = 200;
/** この音量（0〜1 の RMS）を超えたら話していることにする。 */
export const SPEAKING_THRESHOLD = 0.03;

/** 送る音声の制約。ノイズの抑制・エコーの除去・音量の自動調整を有効にする（決定 10。Slack のノイズの抑制に当たる）。 */
export function audioConstraints(deviceId?: string): MediaTrackConstraints {
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };
}

export type MediaDevice = { id: string; label: string };

/** 入れなかった・外れた理由（HuddlePreviewView.problem と HuddleProblem を合わせたもの）。 */
export type CallProblem = "mic-denied" | "no-mic" | "failed" | "full" | "disconnected" | "removed";

export type HuddleCallState =
  | { phase: "idle" }
  | {
      /** 参加する前のプレビュー（追記 B）。マイクの許可はここで求める。 */
      phase: "preview";
      roomId: string;
      micOn: boolean;
      mics: MediaDevice[];
      micId?: string;
      /** スピーカーを選べないブラウザ（setSinkId がない）では undefined。 */
      speakers?: MediaDevice[];
      speakerId?: string;
      problem?: "mic-denied" | "no-mic";
    }
  | {
      phase: "call";
      roomId: string;
      huddleId?: string;
      participantId?: string;
      connection: "connecting" | "connected" | "reconnecting";
      muted: boolean;
      /** 話している人の user_id（自分を含む）。 */
      speaking: string[];
      mics: MediaDevice[];
      micId?: string;
      speakers?: MediaDevice[];
      speakerId?: string;
    }
  | { phase: "problem"; roomId: string; problem: Exclude<CallProblem, "mic-denied" | "no-mic"> };

/** 受けた音声を鳴らす先。detach で止める。 */
export type AudioSink = { setSpeaker(deviceId: string | undefined): void; detach(): void };

/** 音量を測るもの。level は 0〜1。 */
export type LevelMeter = { level(): number; stop(): void };

export type CallEnv = {
  api: Pick<
    ChatApi,
    | "huddleIceServers"
    | "joinHuddle"
    | "subscribeHuddle"
    | "renegotiateHuddle"
    | "unsubscribeHuddle"
    | "setHuddleMuted"
    | "leaveHuddle"
  >;
  /** 自分の user_id。 */
  userId: string;
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  enumerateDevices(): Promise<MediaDeviceInfo[]>;
  createPeerConnection(config: RTCConfiguration): RTCPeerConnection;
  /** 受けた音声を鳴らす。スピーカーを選べないブラウザでは setSpeaker は何もしない。 */
  playAudio(stream: MediaStream, speakerId: string | undefined): AudioSink;
  /** スピーカーを選べるか（HTMLMediaElement.setSinkId があるか）。 */
  canSelectSpeaker: boolean;
  meter(stream: MediaStream): LevelMeter;
  heartbeat(huddleId: string, participantId: string): Promise<"ok" | "gone" | "unsent">;
  /** 選んだ機器を端末ごとに覚える（追記 B）。 */
  prefs: { mic(): string | undefined; setMic(id: string): void; speaker(): string | undefined; setSpeaker(id: string): void };
  /** 通話しているルームをストアに知らせる（別のワークスペースを開いても、そのルームの購読を残すため）。 */
  setCallRoom(roomId: string | null): void;
  now(): number;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(id: unknown): void;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
};

type Remote = { userId: string; mid: string; sink?: AudioSink; meter?: LevelMeter };

export function createHuddleCall(env: CallEnv) {
  let state: HuddleCallState = { phase: "idle" };
  const listeners = new Set<() => void>();

  let stream: MediaStream | undefined;
  let pc: RTCPeerConnection | undefined;
  let sender: RTCRtpSender | undefined;
  let heartbeatTimer: unknown;
  let iceTimer: unknown;
  let speakingTimer: unknown;
  let localMeter: LevelMeter | undefined;
  /** 受けている相手（mid ごと）。 */
  const remotes = new Map<string, Remote>();
  /** mid → user_id。ontrack が subscribe の応答より先に来ることがあるので、流れてきたトラックも覚えておく。 */
  const pendingTracks = new Map<string, MediaStream>();
  /** SDP のやり取りは 1 本の列に並べる（同じ Cloudflare のセッションへの変更は直列にしなければならない。決定 4）。 */
  let queue: Promise<void> = Promise.resolve();
  /** 通話を始め直すたびに進める。古い通話の非同期の続きが、新しい通話の状態を書き換えないようにする。 */
  let generation = 0;

  function set(next: HuddleCallState) {
    state = next;
    for (const l of listeners) l();
  }

  function patchCall(recipe: (s: Extract<HuddleCallState, { phase: "call" }>) => Extract<HuddleCallState, { phase: "call" }>) {
    if (state.phase !== "call") return;
    const next = recipe(state);
    if (next !== state) set(next);
  }

  async function devices(): Promise<{ mics: MediaDevice[]; speakers?: MediaDevice[] }> {
    const list = await env.enumerateDevices().catch(() => [] as MediaDeviceInfo[]);
    const of = (kind: MediaDeviceKind) =>
      list.filter((d) => d.kind === kind).map((d, i) => ({ id: d.deviceId, label: d.label || `${kind === "audioinput" ? "マイク" : "スピーカー"} ${i + 1}` }));
    return { mics: of("audioinput"), speakers: env.canSelectSpeaker ? of("audiooutput") : undefined };
  }

  function stopStream() {
    for (const t of stream?.getTracks() ?? []) t.stop();
    stream = undefined;
  }

  /** 参加する前のプレビューを開く（追記 B）。マイクの許可を求め、機器の一覧を出す。 */
  async function openPreview(roomId: string) {
    if (state.phase === "call") return;
    const gen = ++generation;
    stopStream();
    set({ phase: "preview", roomId, micOn: true, mics: [], speakerId: env.prefs.speaker() });
    try {
      stream = await env.getUserMedia({ audio: audioConstraints(env.prefs.mic()) });
    } catch (err) {
      if (gen !== generation) return;
      const problem = err instanceof DOMException && err.name === "NotFoundError" ? "no-mic" : "mic-denied";
      set({ phase: "preview", roomId, micOn: false, mics: [], problem });
      return;
    }
    if (gen !== generation) {
      stopStream();
      return;
    }
    const d = await devices();
    if (gen !== generation) return;
    const micId = stream.getAudioTracks()[0]?.getSettings().deviceId ?? d.mics[0]?.id;
    const speakerId = env.prefs.speaker() ?? d.speakers?.[0]?.id;
    set({ phase: "preview", roomId, micOn: true, mics: d.mics, micId, speakers: d.speakers, speakerId });
  }

  function cancelPreview() {
    if (state.phase !== "preview") return;
    generation++;
    stopStream();
    set({ phase: "idle" });
  }

  function toggleMic() {
    if (state.phase === "preview" && state.problem === undefined) {
      const micOn = !state.micOn;
      for (const t of stream?.getAudioTracks() ?? []) t.enabled = micOn;
      set({ ...state, micOn });
    } else if (state.phase === "call") {
      void setMuted(!state.muted);
    }
  }

  async function selectMic(id: string) {
    if (state.phase !== "preview" && state.phase !== "call") return;
    env.prefs.setMic(id);
    const next = await env.getUserMedia({ audio: audioConstraints(id) }).catch(() => undefined);
    if (!next || (state.phase !== "preview" && state.phase !== "call")) return;
    const track = next.getAudioTracks()[0];
    const enabled = state.phase === "preview" ? state.micOn : !state.muted;
    if (track) track.enabled = enabled;
    // 通話中は、送っているトラックを差し替える（SDP のやり取りは要らない）
    if (sender && track) await sender.replaceTrack(track);
    stopStream();
    stream = next;
    localMeter?.stop();
    localMeter = state.phase === "call" ? env.meter(next) : undefined;
    set({ ...state, micId: id });
  }

  function selectSpeaker(id: string) {
    if (state.phase !== "preview" && state.phase !== "call") return;
    env.prefs.setSpeaker(id);
    for (const r of remotes.values()) r.sink?.setSpeaker(id);
    set({ ...state, speakerId: id });
  }

  /** 入る（決定 4）。プレビューの状態（マイクのオンとオフ・選んだ機器）のまま入る。 */
  async function join() {
    if (state.phase !== "preview" || state.problem !== undefined || !stream) return;
    const gen = ++generation;
    const { roomId, micOn, mics, micId, speakers, speakerId } = state;
    set({ phase: "call", roomId, connection: "connecting", muted: !micOn, speaking: [], mics, micId, speakers, speakerId });
    env.setCallRoom(roomId);
    try {
      const ice = await env.api.huddleIceServers(roomId);
      if (gen !== generation) return;
      pc = env.createPeerConnection({ iceServers: toIceServers(ice) });
      scheduleIceRefresh(roomId, ice, gen);
      watchConnection(pc, gen);
      const track = stream.getAudioTracks()[0];
      const transceiver = pc.addTransceiver(track, { direction: "sendonly" });
      sender = transceiver.sender;
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await iceGathered(pc);
      if (gen !== generation) return;
      const joined = await env.api.joinHuddle(roomId, {
        offer: { type: "offer", sdp: pc.localDescription?.sdp ?? offer.sdp ?? "" },
        mid: transceiver.mid ?? "0",
      });
      if (gen !== generation) {
        // 待っている間に抜けた（キャンセルした）。入った分をすぐに戻す
        void env.api.leaveHuddle(joined.huddle.id, joined.participant_id).catch(() => {});
        return;
      }
      await pc.setRemoteDescription({ type: "answer", sdp: joined.answer.sdp });
      patchCall((s) => ({ ...s, huddleId: joined.huddle.id, participantId: joined.participant_id }));
      if (!micOn) void env.api.setHuddleMuted(joined.huddle.id, joined.participant_id, true).catch(() => {});
      localMeter = env.meter(stream);
      heartbeatTimer = env.setInterval(() => void beat(gen), HEARTBEAT_INTERVAL_MS);
      speakingTimer = env.setInterval(measureSpeaking, SPEAKING_POLL_MS);
      // 先に入っている人の音声を受ける。この後の出入りは huddle.updated から sync で追う
      void sync(joined.huddle.participants.map((p) => p.user_id));
    } catch (err) {
      if (gen !== generation) return;
      teardown();
      set({ phase: "problem", roomId, problem: err instanceof ApiError && err.type === "huddle-full" ? "full" : "failed" });
    }
  }

  /**
   * TURN の認証情報は 12 時間で切れる（決定 14）。切れる前に取り直して差し替える。
   * 差し替えても今の経路は切れず、次に経路を選び直すとき（ネットワークが変わったとき）から新しい値を使う。
   */
  function scheduleIceRefresh(roomId: string, ice: HuddleICEServers, gen: number) {
    const delay = Math.max(new Date(ice.expires_at).getTime() - env.now() - ICE_REFRESH_BEFORE_MS, 60_000);
    iceTimer = env.setTimeout(async () => {
      const next = await env.api.huddleIceServers(roomId).catch(() => undefined);
      if (gen !== generation || !pc) return;
      if (next) {
        pc.setConfiguration({ ...pc.getConfiguration(), iceServers: toIceServers(next) });
        scheduleIceRefresh(roomId, next, gen);
      } else {
        // 取れなかった（一時的な失敗）。1 分後にもう一度
        scheduleIceRefresh(roomId, { ...ice, expires_at: new Date(env.now() + ICE_REFRESH_BEFORE_MS + 60_000).toISOString() }, gen);
      }
    }, delay);
  }

  function watchConnection(conn: RTCPeerConnection, gen: number) {
    conn.onconnectionstatechange = () => {
      if (gen !== generation) return;
      switch (conn.connectionState) {
        case "connected":
          patchCall((s) => (s.connection === "connected" ? s : { ...s, connection: "connected" }));
          return;
        case "disconnected":
          // 一時的に切れた。ブラウザが自分でつなぎ直すのを待つ（failed になったら諦める）
          patchCall((s) => (s.connection === "reconnecting" ? s : { ...s, connection: "reconnecting" }));
          return;
        case "failed":
          void end("failed");
          return;
      }
    };
    conn.ontrack = (event) => {
      const mid = event.transceiver.mid;
      if (!mid) return;
      const remoteStream = event.streams[0] ?? new MediaStream([event.track]);
      const remote = remotes.get(mid);
      if (remote) attach(remote, remoteStream);
      else pendingTracks.set(mid, remoteStream);
    };
  }

  function attach(remote: Remote, remoteStream: MediaStream) {
    if (remote.sink) return;
    remote.sink = env.playAudio(remoteStream, state.phase === "call" ? state.speakerId : undefined);
    remote.meter = env.meter(remoteStream);
  }

  async function beat(gen: number) {
    if (state.phase !== "call" || !state.huddleId || !state.participantId) return;
    const res = await env.heartbeat(state.huddleId, state.participantId);
    // 参加がもうない（30 秒届かなかった・別の端末に移った）。サーバーはもう外している（決定 5）
    if (res === "gone" && gen === generation) await end("disconnected", { leave: false });
  }

  /**
   * いま入っている人に合わせて、受ける音声を増やし・減らす（決定 9）。ハドルの状態（huddle.updated）が変わるたびに呼ぶ。
   * SDP のやり取りは 1 本の列に並べる（決定 4）。
   */
  function sync(participantIds: readonly string[]) {
    const gen = generation;
    queue = queue.then(() => syncNow(gen, participantIds)).catch(() => {});
    return queue;
  }

  async function syncNow(gen: number, participantIds: readonly string[]) {
    if (gen !== generation || state.phase !== "call" || !state.huddleId || !state.participantId || !pc) return;
    const { huddleId, participantId } = state;
    const others = new Set(participantIds.filter((id) => id !== env.userId));
    const subscribed = new Set([...remotes.values()].map((r) => r.userId));

    // 抜けた人の分を閉じる
    const gone = [...remotes.values()].filter((r) => !others.has(r.userId));
    if (gone.length > 0) {
      for (const r of gone) {
        r.sink?.detach();
        r.meter?.stop();
        remotes.delete(r.mid);
      }
      await env.api.unsubscribeHuddle(huddleId, participantId, gone.map((r) => r.mid)).catch(() => {});
    }

    const added = [...others].filter((id) => !subscribed.has(id));
    if (added.length === 0) return;
    const res = await withConflictRetry(() => env.api.subscribeHuddle(huddleId, participantId, added));
    if (gen !== generation || !pc) return;
    for (const t of res.tracks) {
      const remote: Remote = { userId: t.user_id, mid: t.mid };
      remotes.set(t.mid, remote);
      const pending = pendingTracks.get(t.mid);
      if (pending) {
        pendingTracks.delete(t.mid);
        attach(remote, pending);
      }
    }
    if (res.offer) {
      await pc.setRemoteDescription({ type: "offer", sdp: res.offer.sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await withConflictRetry(() =>
        env.api.renegotiateHuddle(huddleId, participantId, { type: "answer", sdp: pc?.localDescription?.sdp ?? answer.sdp ?? "" }),
      );
    }
  }

  /** 同じセッションへの変更が重なった（409 huddle-negotiation-conflict）ら、少し待って 1 回だけやり直す（決定 4）。 */
  async function withConflictRetry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof ApiError && err.type === "huddle-negotiation-conflict")) throw err;
      await new Promise((resolve) => env.setTimeout(() => resolve(undefined), 300));
      return fn();
    }
  }

  async function setMuted(muted: boolean) {
    if (state.phase !== "call") return;
    // 音を止めるのはブラウザ。サーバーに知らせるのは、ほかの人の画面にミュートの印を出すため（決定 10）
    for (const t of stream?.getAudioTracks() ?? []) t.enabled = !muted;
    patchCall((s) => ({ ...s, muted }));
    if (state.huddleId && state.participantId) {
      await env.api.setHuddleMuted(state.huddleId, state.participantId, muted).catch(() => {});
    }
  }

  function measureSpeaking() {
    if (state.phase !== "call") return;
    const speaking: string[] = [];
    if (!state.muted && localMeter && localMeter.level() > SPEAKING_THRESHOLD) speaking.push(env.userId);
    for (const r of remotes.values()) {
      if (r.meter && r.meter.level() > SPEAKING_THRESHOLD && !speaking.includes(r.userId)) speaking.push(r.userId);
    }
    speaking.sort();
    patchCall((s) => (sameList(s.speaking, speaking) ? s : { ...s, speaking }));
  }

  /** 抜ける。keepalive はタブを閉じるときに使う（決定 4）。 */
  async function leave(options: { keepalive?: boolean } = {}) {
    if (state.phase === "problem") {
      set({ phase: "idle" });
      return;
    }
    await end(null, { keepalive: options.keepalive });
  }

  /** 通話を片付ける。problem があれば、その知らせを出す。leave が false なら、サーバーはもう外している。 */
  async function end(problem: "failed" | "disconnected" | "removed" | null, { leave = true, keepalive = false } = {}) {
    if (state.phase !== "call") return;
    const { roomId, huddleId, participantId } = state;
    generation++;
    teardown();
    set(problem ? { phase: "problem", roomId, problem } : { phase: "idle" });
    if (leave && huddleId && participantId) {
      await env.api.leaveHuddle(huddleId, participantId, { keepalive }).catch(() => {});
    }
  }

  /** huddle.left（決定 5・6・8）。自分のこの端末の参加なら片付ける。 */
  function receiveLeft(data: HuddleLeftData) {
    if (state.phase !== "call" || state.participantId !== data.participant_id) return;
    const problem = data.reason === "removed" ? "removed" : data.reason === "expired" ? "disconnected" : null;
    void end(problem, { leave: false });
  }

  function teardown() {
    if (state.phase === "call") env.setCallRoom(null);
    env.clearTimeout(iceTimer);
    iceTimer = undefined;
    env.clearInterval(heartbeatTimer);
    env.clearInterval(speakingTimer);
    heartbeatTimer = undefined;
    speakingTimer = undefined;
    localMeter?.stop();
    localMeter = undefined;
    for (const r of remotes.values()) {
      r.sink?.detach();
      r.meter?.stop();
    }
    remotes.clear();
    pendingTracks.clear();
    pc?.close();
    pc = undefined;
    sender = undefined;
    stopStream();
    queue = Promise.resolve();
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    openPreview,
    cancelPreview,
    toggleMic,
    selectMic,
    selectSpeaker,
    join,
    sync,
    setMuted,
    leave,
    receiveLeft,
    /** 知らせ（入れなかった・外れた）を閉じる。 */
    dismissProblem() {
      if (state.phase === "problem") set({ phase: "idle" });
    },
    dispose() {
      generation++;
      teardown();
    },
  };
}

export type HuddleCall = ReturnType<typeof createHuddleCall>;

function toIceServers(ice: HuddleICEServers): RTCIceServer[] {
  return ice.ice_servers.map((s) => ({ urls: s.urls, username: s.username, credential: s.credential }));
}

/** ICE の候補を集め終わるまで待つ（上限つき）。 */
function iceGathered(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ICE_GATHERING_TIMEOUT_MS);
    function done() {
      clearTimeout(timer);
      pc.removeEventListener("icegatheringstatechange", check);
      resolve();
    }
    function check() {
      if (pc.iceGatheringState === "complete") done();
    }
    pc.addEventListener("icegatheringstatechange", check);
  });
}

function sameList(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
