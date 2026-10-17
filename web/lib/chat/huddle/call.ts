import type { HuddleLeftData, HuddleICEServers, HuddleQuality, HuddleTrackKind, HuddleTrackRequest } from "@/lib/api/types.gen";
import { ApiError } from "@/lib/api/error";
import type { ChatApi } from "@/lib/chat/api/chat-api";

import type { StageTrack } from "./stage";

/**
 * ハドルの通話（ADR 0066・0068）。マイク・カメラ・画面共有・RTCPeerConnection・心拍・話している人の判定を持つ。
 *
 * 通話はチャットのタブが持つ（追記 C）。ハドルのタブ（about:blank）は画面を映すだけで、この状態を読んで描く。
 * 音声と映像はブラウザと Cloudflare の間を直接流れ、Go のサーバーが受け持つのは SDP の中継だけ（決定 2）。
 * カメラと画面は、音声と同じ RTCPeerConnection に別のトラックとして足す（ADR 0068 決定 1）。
 *
 * ブラウザの API（getUserMedia・getDisplayMedia・RTCPeerConnection・音の出力・音量の測定）は外から渡す。テストで偽物に差し替えるため。
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

/**
 * カメラを送る simulcast の層（ADR 0068 決定 6）。rid はサーバーの `SimulcastRIDs`（internal/chat/huddle）と同じ名前にする。
 * a・b・c の順が「高い層から低い層」で、Cloudflare の asciibetical（a に近いほど望ましい）と同じ向き。
 * ビットレートは ADR の見積もりの目安。実物で直してよい。
 */
export const CAMERA_ENCODINGS: RTCRtpEncodingParameters[] = [
  { rid: "a", maxBitrate: 1_200_000, maxFramerate: 30 },
  { rid: "b", scaleResolutionDownBy: 2, maxBitrate: 400_000, maxFramerate: 24 },
  { rid: "c", scaleResolutionDownBy: 4, maxBitrate: 150_000, maxFramerate: 15 },
];

/** 画面共有は 1 つの層（決定 7）。文字が読めることを優先して、フレームレートを抑える。 */
export const SCREEN_ENCODING: RTCRtpEncodingParameters = { maxBitrate: 1_500_000, maxFramerate: 15 };

/** 送る音声の制約。ノイズの抑制・エコーの除去・音量の自動調整を有効にする（決定 10。Slack のノイズの抑制に当たる）。 */
export function audioConstraints(deviceId?: string): MediaTrackConstraints {
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };
}

/** 送るカメラの制約。いちばん上の層（a）を 1280×720 までにする（ADR 0068 決定 6）。 */
export function videoConstraints(deviceId?: string): MediaTrackConstraints {
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    width: { ideal: 1280, max: 1280 },
    height: { ideal: 720, max: 720 },
    frameRate: { ideal: 30, max: 30 },
  };
}

/**
 * 画面共有の求め方（ADR 0068 決定 7）。自分のハドルのタブを共有の候補から外す（合わせ鏡になるのを避ける）。
 * 画面の音声は取らない（オーナーの確認 1）。selfBrowserSurface は型の定義にまだないので、型を付け直す。
 */
export const DISPLAY_MEDIA_OPTIONS = {
  video: { frameRate: { ideal: 15, max: 15 } },
  audio: false,
  selfBrowserSurface: "exclude",
} as DisplayMediaStreamOptions;

export type MediaDevice = { id: string; label: string };

/** 入れなかった・外れた理由（HuddlePreviewView.problem と HuddleProblem を合わせたもの）。 */
export type CallProblem = "mic-denied" | "no-mic" | "failed" | "full" | "disconnected" | "removed";

/** カメラを使えない理由。 */
export type CameraProblem = "camera-denied" | "no-camera";

/** 入った後の知らせ（ADR 0068 決定 9）。閉じるまで残す。 */
export type CallNotice = CameraProblem | "screen-denied" | "screen-share-full";

/** 送るトラックのうち、入った後に始め・やめるもの（音声は入る・抜けるで送る）。 */
export type OutgoingKind = Exclude<HuddleTrackKind, "audio">;

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
      /** カメラ（ADR 0068 決定 1）。既定はオフ。オンにしたときに許可を求める。 */
      cameraOn: boolean;
      cameras: MediaDevice[];
      cameraId?: string;
      cameraProblem?: CameraProblem;
      /** オンのときの自分のカメラの映像。 */
      video?: MediaStream;
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
      /** カメラを付けている（ADR 0068）。付けている間の自分の映像は video。 */
      camera: boolean;
      video?: MediaStream;
      cameras: MediaDevice[];
      cameraId?: string;
      /** 画面を共有している。共有している画面は screen。 */
      sharing: boolean;
      screen?: MediaStream;
      /** 画面を共有できるブラウザか（モバイルのブラウザには getDisplayMedia がない。決定 9）。 */
      canShareScreen: boolean;
      notice?: CallNotice;
      /** 受けているほかの人のカメラと画面（`videoKey` ごと）。ステージに載せた分だけ（ADR 0068 決定 5）。 */
      remoteVideos: Readonly<Record<string, MediaStream>>;
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
    | "publishHuddleTrack"
    | "unpublishHuddleTrack"
    | "setHuddleSubscriptionQuality"
  >;
  /** 自分の user_id。 */
  userId: string;
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  /**
   * 画面の共有を求める。ないブラウザ（モバイル）では undefined。
   * 押した操作の中で、待たずに呼ぶこと（操作をきっかけにしない getDisplayMedia は断られる）。
   * from はボタンを押したタブ（ハドルのタブ）。チャットのタブで断られたとき、そちらで求め直すために使う。
   */
  getDisplayMedia?(options: DisplayMediaStreamOptions, from?: Window): Promise<MediaStream>;
  enumerateDevices(): Promise<MediaDeviceInfo[]>;
  createPeerConnection(config: RTCConfiguration): RTCPeerConnection;
  /** 受けた音声を鳴らす。スピーカーを選べないブラウザでは setSpeaker は何もしない。 */
  playAudio(stream: MediaStream, speakerId: string | undefined): AudioSink;
  /** スピーカーを選べるか（HTMLMediaElement.setSinkId があるか）。 */
  canSelectSpeaker: boolean;
  meter(stream: MediaStream): LevelMeter;
  heartbeat(huddleId: string, participantId: string): Promise<"ok" | "gone" | "unsent">;
  /** 選んだ機器を端末ごとに覚える（追記 B）。 */
  prefs: {
    mic(): string | undefined;
    setMic(id: string): void;
    speaker(): string | undefined;
    setSpeaker(id: string): void;
    camera(): string | undefined;
    setCamera(id: string): void;
  };
  /** 通話しているルームをストアに知らせる（別のワークスペースを開いても、そのルームの購読を残すため）。 */
  setCallRoom(roomId: string | null): void;
  now(): number;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(id: unknown): void;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
};

/** 受けているトラック（mid ごと）。音声は鳴らして音量を測り、映像は remoteVideos に置く。 */
type Remote = { userId: string; kind: HuddleTrackKind; mid: string; quality?: HuddleQuality; sink?: AudioSink; meter?: LevelMeter };

/** 受けている映像の鍵（`<user id>:camera` / `<user id>:screen`）。 */
export function videoKey(userId: string, kind: "camera" | "screen") {
  return `${userId}:${kind}`;
}

/** 送っている（送ろうとしている）カメラか画面（ADR 0068 決定 1）。止めたら transceiver ごと止める（決定 2）。 */
type Outgoing = { stream: MediaStream; transceiver?: RTCRtpTransceiver };

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
  /** 送っているカメラと画面。 */
  const outgoing: Partial<Record<OutgoingKind, Outgoing>> = {};
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

  function enqueue(work: () => Promise<void>) {
    queue = queue.then(work).catch(() => {});
    return queue;
  }

  async function devices(): Promise<{ mics: MediaDevice[]; speakers?: MediaDevice[]; cameras: MediaDevice[] }> {
    const list = await env.enumerateDevices().catch(() => [] as MediaDeviceInfo[]);
    const fallback: Record<MediaDeviceKind, string> = { audioinput: "マイク", audiooutput: "スピーカー", videoinput: "カメラ" };
    const of = (kind: MediaDeviceKind) =>
      list.filter((d) => d.kind === kind).map((d, i) => ({ id: d.deviceId, label: d.label || `${fallback[kind]} ${i + 1}` }));
    return { mics: of("audioinput"), speakers: env.canSelectSpeaker ? of("audiooutput") : undefined, cameras: of("videoinput") };
  }

  function stopStream() {
    for (const t of stream?.getTracks() ?? []) t.stop();
    stream = undefined;
  }

  function stopTracks(s: MediaStream | undefined) {
    for (const t of s?.getTracks() ?? []) t.stop();
  }

  function stopOutgoing(kind: OutgoingKind) {
    const o = outgoing[kind];
    if (!o) return;
    stopTracks(o.stream);
    o.transceiver?.stop();
    delete outgoing[kind];
  }

  /** カメラを求める。使えなければ理由を返す。 */
  async function openCamera(deviceId: string | undefined): Promise<MediaStream | CameraProblem> {
    try {
      return await env.getUserMedia({ video: videoConstraints(deviceId) });
    } catch (err) {
      return err instanceof DOMException && (err.name === "NotFoundError" || err.name === "OverconstrainedError")
        ? "no-camera"
        : "camera-denied";
    }
  }

  /** 参加する前のプレビューを開く（追記 B）。マイクの許可を求め、機器の一覧を出す。カメラは既定でオフ（ADR 0068 決定 1）。 */
  async function openPreview(roomId: string) {
    if (state.phase === "call") return;
    const gen = ++generation;
    stopStream();
    stopOutgoing("camera");
    set({ phase: "preview", roomId, micOn: true, mics: [], speakerId: env.prefs.speaker(), cameraOn: false, cameras: [] });
    try {
      stream = await env.getUserMedia({ audio: audioConstraints(env.prefs.mic()) });
    } catch (err) {
      if (gen !== generation) return;
      const problem = err instanceof DOMException && err.name === "NotFoundError" ? "no-mic" : "mic-denied";
      set({ phase: "preview", roomId, micOn: false, mics: [], problem, cameraOn: false, cameras: [] });
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
    set({
      phase: "preview",
      roomId,
      micOn: true,
      mics: d.mics,
      micId,
      speakers: d.speakers,
      speakerId,
      cameraOn: false,
      cameras: d.cameras,
      cameraId: env.prefs.camera() ?? d.cameras[0]?.id,
    });
  }

  function cancelPreview() {
    if (state.phase !== "preview") return;
    generation++;
    stopStream();
    stopOutgoing("camera");
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

  /**
   * カメラのオンとオフ（ADR 0068 決定 1・2）。
   * プレビューでは自分の映像を映すだけ。通話中は、付けたら送り始め、消したらトラックを閉じる（止めたまま送り続けない）。
   */
  async function toggleCamera() {
    if (state.phase !== "preview" && state.phase !== "call") return;
    const on = state.phase === "preview" ? state.cameraOn : state.camera;
    if (on) {
      if (state.phase === "call") return unpublish("camera");
      stopOutgoing("camera");
      set({ ...state, cameraOn: false, video: undefined });
      return;
    }
    const gen = generation;
    const got = await openCamera(state.cameraId);
    if (gen !== generation || (state.phase !== "preview" && state.phase !== "call")) {
      if (typeof got !== "string") stopTracks(got);
      return;
    }
    if (typeof got === "string") {
      if (state.phase === "preview") set({ ...state, cameraOn: false, cameraProblem: got });
      else patchCall((s) => ({ ...s, notice: got }));
      return;
    }
    stopOutgoing("camera");
    outgoing.camera = { stream: got };
    // 許可が出た後は、機器の名前が読めるようになるので、一覧を取り直す
    const d = await devices();
    if (gen !== generation || outgoing.camera?.stream !== got) return;
    const cameraId = got.getVideoTracks()[0]?.getSettings().deviceId ?? state.cameraId;
    if (state.phase === "preview") {
      set({ ...state, cameraOn: true, video: got, cameras: d.cameras, cameraId, cameraProblem: undefined });
      return;
    }
    patchCall((s) => ({
      ...s,
      camera: true,
      video: got,
      cameras: d.cameras,
      cameraId,
      notice: s.notice === "camera-denied" || s.notice === "no-camera" ? undefined : s.notice,
    }));
    await publish(gen, "camera");
  }

  /** カメラを替える。送っている間は replaceTrack で差し替える（SDP のやり取りは要らない。音声の機器の選択と同じ）。 */
  async function selectCamera(id: string) {
    if (state.phase !== "preview" && state.phase !== "call") return;
    env.prefs.setCamera(id);
    const o = outgoing.camera;
    if (!o) {
      set({ ...state, cameraId: id });
      return;
    }
    const got = await openCamera(id);
    if (typeof got === "string" || outgoing.camera !== o || (state.phase !== "preview" && state.phase !== "call")) {
      if (typeof got !== "string") stopTracks(got);
      return;
    }
    const track = got.getVideoTracks()[0];
    if (o.transceiver && track) await o.transceiver.sender.replaceTrack(track);
    stopTracks(o.stream);
    o.stream = got;
    set({ ...state, cameraId: id, video: got });
  }

  /**
   * 画面共有を始める・やめる（ADR 0068 決定 7）。
   * 始めるときは、押した操作の中で getDisplayMedia を呼ぶ（await の前に呼ぶ）。from はボタンを押したタブ。
   */
  function toggleShare(from?: Window): Promise<void> {
    if (state.phase !== "call") return Promise.resolve();
    if (state.sharing) return unpublish("screen");
    if (!env.getDisplayMedia) return Promise.resolve();
    const gen = generation;
    return env.getDisplayMedia(DISPLAY_MEDIA_OPTIONS, from).then(
      async (got) => {
        if (gen !== generation || state.phase !== "call" || state.sharing) {
          stopTracks(got);
          return;
        }
        const track = got.getVideoTracks()[0];
        if (track) {
          // 文字が読めることを優先する（解像度を保って、フレームレートを落とす）
          track.contentHint = "detail";
          // ブラウザの「共有を停止」（共有を求めたタブが閉じた場合も）で終わったら、こちらでもやめる
          track.addEventListener("ended", () => {
            if (outgoing.screen?.stream === got) void unpublish("screen");
          });
        }
        outgoing.screen = { stream: got };
        patchCall((s) => ({ ...s, sharing: true, screen: got, notice: s.notice === "screen-denied" ? undefined : s.notice }));
        await publish(gen, "screen");
      },
      (err: unknown) => {
        // 共有する画面を選ばずに閉じたときは知らせない。OS が画面の収録を許可していないときだけ知らせる
        if (gen !== generation) return;
        if (err instanceof DOMException && err.name === "NotAllowedError" && /system/i.test(err.message)) {
          patchCall((s) => ({ ...s, notice: "screen-denied" }));
        }
      },
    );
  }

  /** 送り始める（ADR 0068 決定 3）。transceiver を足した offer を送り、answer を当てる。失敗したら元に戻す。 */
  function publish(gen: number, kind: OutgoingKind) {
    return enqueue(async () => {
      const o = outgoing[kind];
      if (gen !== generation || state.phase !== "call" || !state.huddleId || !state.participantId || !pc || !o) return;
      const { huddleId, participantId } = state;
      const conn = pc;
      const track = o.stream.getVideoTracks()[0];
      if (!track) return;
      const transceiver = conn.addTransceiver(track, {
        direction: "sendonly",
        sendEncodings: kind === "camera" ? CAMERA_ENCODINGS : [SCREEN_ENCODING],
      });
      o.transceiver = transceiver;
      try {
        const offer = await conn.createOffer();
        await conn.setLocalDescription(offer);
        const res = await withConflictRetry(() =>
          env.api.publishHuddleTrack(huddleId, participantId, {
            kind,
            offer: { type: "offer", sdp: conn.localDescription?.sdp ?? offer.sdp ?? "" },
            mid: transceiver.mid ?? "",
          }),
        );
        if (gen !== generation) return;
        await conn.setRemoteDescription({ type: "answer", sdp: res.answer.sdp });
      } catch (err) {
        if (gen !== generation) return;
        // 出した offer を取り消して、足した transceiver を止める（次の SDP のやり取りに残さない）
        if (conn.signalingState === "have-local-offer") await conn.setLocalDescription({ type: "rollback" }).catch(() => {});
        if (outgoing[kind] === o) stopOutgoing(kind);
        const full = err instanceof ApiError && err.type === "huddle-screen-share-full";
        patchCall((s) =>
          kind === "camera"
            ? { ...s, camera: false, video: undefined }
            : { ...s, sharing: false, screen: undefined, notice: full ? "screen-share-full" : s.notice },
        );
      }
    });
  }

  /** 送るのをやめる（ADR 0068 決定 2・3）。画面からはすぐに消し、サーバーへの知らせと transceiver の片付けは列に並べる。 */
  function unpublish(kind: OutgoingKind) {
    if (state.phase !== "call") return Promise.resolve();
    const { huddleId, participantId } = state;
    const o = outgoing[kind];
    patchCall((s) => (kind === "camera" ? { ...s, camera: false, video: undefined } : { ...s, sharing: false, screen: undefined }));
    // 映像は先に止める（カメラの使用中の印をすぐに消す）
    stopTracks(o?.stream);
    return enqueue(async () => {
      if (o && outgoing[kind] === o) stopOutgoing(kind);
      if (huddleId && participantId) await env.api.unpublishHuddleTrack(huddleId, participantId, kind).catch(() => {});
    });
  }

  function dismissNotice() {
    patchCall((s) => (s.notice === undefined ? s : { ...s, notice: undefined }));
  }

  /** 入る（決定 4）。プレビューの状態（マイクのオンとオフ・選んだ機器・カメラ）のまま入る。 */
  async function join() {
    if (state.phase !== "preview" || state.problem !== undefined || !stream) return;
    const gen = ++generation;
    const { roomId, micOn, mics, micId, speakers, speakerId, cameraOn, cameras, cameraId } = state;
    const camera = cameraOn && outgoing.camera !== undefined;
    set({
      phase: "call",
      roomId,
      connection: "connecting",
      muted: !micOn,
      speaking: [],
      mics,
      micId,
      speakers,
      speakerId,
      camera,
      video: camera ? outgoing.camera?.stream : undefined,
      cameras,
      cameraId,
      sharing: false,
      canShareScreen: env.getDisplayMedia !== undefined,
      remoteVideos: {},
    });
    env.setCallRoom(roomId);
    try {
      const ice = await env.api.huddleIceServers(roomId);
      if (gen !== generation) return;
      // relay はサーバーが開発で TURN の経路を確かめるときだけ返す（HUDDLE_ICE_TRANSPORT_POLICY）。値の判断はサーバーに任せる
      pc = env.createPeerConnection({ iceServers: toIceServers(ice), iceTransportPolicy: ice.ice_transport_policy });
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
      // プレビューでカメラを付けていたら、入った後で送り始める（音声の「入る」とは別の SDP のやり取り）
      if (camera) void publish(gen, "camera");
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
    if (remote.kind !== "audio") {
      const key = videoKey(remote.userId, remote.kind);
      patchCall((s) => (s.remoteVideos[key] === remoteStream ? s : { ...s, remoteVideos: { ...s.remoteVideos, [key]: remoteStream } }));
      return;
    }
    if (remote.sink) return;
    remote.sink = env.playAudio(remoteStream, state.phase === "call" ? state.speakerId : undefined);
    remote.meter = env.meter(remoteStream);
  }

  /** 受けているものを閉じる（画面から外し、Cloudflare の受けるトラックも閉じる）。 */
  async function release(huddleId: string, participantId: string, gone: Remote[]) {
    if (gone.length === 0) return;
    const keys: string[] = [];
    for (const r of gone) {
      r.sink?.detach();
      r.meter?.stop();
      remotes.delete(r.mid);
      if (r.kind !== "audio") keys.push(videoKey(r.userId, r.kind));
    }
    if (keys.length > 0) {
      patchCall((s) => {
        const remoteVideos = { ...s.remoteVideos };
        for (const k of keys) delete remoteVideos[k];
        return { ...s, remoteVideos };
      });
    }
    await env.api.unsubscribeHuddle(huddleId, participantId, gone.map((r) => r.mid)).catch(() => {});
  }

  /** 受け始める。SFU の offer が返ったら answer を返す（決定 9）。SDP の列の中で呼ぶ。 */
  async function receive(gen: number, huddleId: string, participantId: string, reqs: HuddleTrackRequest[]) {
    if (reqs.length === 0 || !pc) return;
    const res = await withConflictRetry(() => env.api.subscribeHuddle(huddleId, participantId, reqs));
    if (gen !== generation || !pc) return;
    for (const t of res.tracks) {
      const quality = reqs.find((r) => r.user_id === t.user_id && r.kind === t.kind)?.quality;
      const remote: Remote = { userId: t.user_id, kind: t.kind, mid: t.mid, quality };
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
    return enqueue(() => syncNow(gen, participantIds));
  }

  async function syncNow(gen: number, participantIds: readonly string[]) {
    if (gen !== generation || state.phase !== "call" || !state.huddleId || !state.participantId || !pc) return;
    const { huddleId, participantId } = state;
    const others = new Set(participantIds.filter((id) => id !== env.userId));
    const audio = [...remotes.values()].filter((r) => r.kind === "audio");
    const subscribed = new Set(audio.map((r) => r.userId));

    // 抜けた人の分を閉じる（映像はステージの選び直しで閉じる。syncVideo）
    await release(huddleId, participantId, audio.filter((r) => !others.has(r.userId)));

    const added = [...others].filter((id) => !subscribed.has(id));
    await receive(gen, huddleId, participantId, added.map((userId) => ({ user_id: userId, kind: "audio" as const })));
  }

  /**
   * ステージに載せた映像に合わせて、受ける映像を増やし・減らし、層を替える（ADR 0068 決定 5・6）。
   * 外れたものは閉じ（受けたまま止める仕組みは SFU にない）、層だけが変わったものは tracks/update で替える（SDP のやり取りなし）。
   */
  function syncVideo(tracks: readonly StageTrack[]) {
    const gen = generation;
    return enqueue(async () => {
      if (gen !== generation || state.phase !== "call" || !state.huddleId || !state.participantId || !pc) return;
      const { huddleId, participantId } = state;
      const current = new Map([...remotes.values()].filter((r) => r.kind !== "audio").map((r) => [videoKey(r.userId, r.kind as "camera" | "screen"), r]));
      const wanted = new Map(tracks.map((t) => [videoKey(t.userId, t.kind), t]));

      await release(huddleId, participantId, [...current].filter(([k]) => !wanted.has(k)).map(([, r]) => r));

      for (const [k, t] of wanted) {
        const r = current.get(k);
        if (!r || t.kind !== "camera" || !t.quality || r.quality === t.quality) continue;
        // 層だけを替える。相手がカメラを止めた直後なら 404 になるが、次の huddle.updated で閉じる
        await env.api.setHuddleSubscriptionQuality(huddleId, participantId, r.mid, t.userId, t.quality).then(
          () => void (r.quality = t.quality),
          () => {},
        );
      }

      const added = [...wanted].filter(([k]) => !current.has(k)).map(([, t]) => t);
      await receive(
        gen,
        huddleId,
        participantId,
        added.map((t) => ({ user_id: t.userId, kind: t.kind, ...(t.quality ? { quality: t.quality } : {}) })),
      );
    });
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
    // カメラと画面も止める（ブラウザの使用中の印を消す）。pc を閉じるので transceiver は止めなくてよい
    for (const kind of ["camera", "screen"] as const) {
      stopTracks(outgoing[kind]?.stream);
      delete outgoing[kind];
    }
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
    toggleCamera,
    selectCamera,
    toggleShare,
    dismissNotice,
    join,
    sync,
    syncVideo,
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
