import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/error";
import { PROBLEM_TYPE_PREFIX, type RoomHuddle } from "@/lib/api/types.gen";

import { type CallEnv, type HuddleCallState, HEARTBEAT_INTERVAL_MS, SPEAKING_POLL_MS, createHuddleCall } from "./call";

const ME = "u-me";
const ROOM = "r-1";

function huddle(participants: string[]): RoomHuddle {
  return {
    id: "h-1",
    room_id: ROOM,
    message_id: "m-1",
    started_at: "2026-09-26T00:00:00Z",
    version: 1,
    participants: participants.map((user_id) => ({ user_id, muted: false })),
    joining_soon: [],
  };
}

function fakeTrack(deviceId = "mic-1") {
  return { enabled: true, stop: vi.fn(), getSettings: () => ({ deviceId }) } as unknown as MediaStreamTrack;
}

function fakeStream(track = fakeTrack()) {
  return { getAudioTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream;
}

type FakePc = RTCPeerConnection & {
  sender: { replaceTrack: ReturnType<typeof vi.fn> };
  fire(state: RTCPeerConnectionState): void;
  track(mid: string): void;
};

function fakePc(): FakePc {
  const sender = { replaceTrack: vi.fn(async () => {}) };
  let config: RTCConfiguration = {};
  const pc = {
    iceGatheringState: "complete",
    connectionState: "new",
    localDescription: null as RTCSessionDescriptionInit | null,
    onconnectionstatechange: null as (() => void) | null,
    ontrack: null as ((e: RTCTrackEvent) => void) | null,
    // 本物と同じく、mid は setLocalDescription の後に決まる
    addTransceiver: vi.fn(() => {
      const t = { mid: null as string | null, sender };
      pc.setLocalDescription.mockImplementationOnce(async (d: RTCSessionDescriptionInit) => {
        pc.localDescription = d;
        t.mid = "0";
      });
      return t;
    }),
    createOffer: vi.fn(async () => ({ type: "offer", sdp: "local-offer" })),
    createAnswer: vi.fn(async () => ({ type: "answer", sdp: "local-answer" })),
    setLocalDescription: vi.fn(async (d: RTCSessionDescriptionInit) => {
      pc.localDescription = d;
    }),
    setRemoteDescription: vi.fn(async () => {}),
    setConfiguration: vi.fn((c: RTCConfiguration) => {
      config = c;
    }),
    getConfiguration: () => config,
    close: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    sender,
    fire(state: RTCPeerConnectionState) {
      pc.connectionState = state;
      pc.onconnectionstatechange?.();
    },
    track(mid: string) {
      pc.ontrack?.({ transceiver: { mid }, streams: [fakeStream()], track: fakeTrack() } as unknown as RTCTrackEvent);
    },
  };
  return pc as unknown as FakePc;
}

function setup(overrides: Partial<CallEnv> = {}) {
  const pcs: FakePc[] = [];
  const intervals = new Map<number, () => void>();
  const timeouts = new Map<number, () => void>();
  let nextId = 1;
  const sinks: { stream: MediaStream; setSpeaker: ReturnType<typeof vi.fn>; detach: ReturnType<typeof vi.fn> }[] = [];
  const levels = new Map<MediaStream, number>();
  const prefs: Record<string, string> = {};
  const api = {
    huddleIceServers: vi.fn(async () => ({
      ice_servers: [{ urls: ["turn:turn.example"], username: "u", credential: "c" }],
      expires_at: new Date(Date.parse("2026-09-26T12:00:00Z")).toISOString(),
    })),
    joinHuddle: vi.fn(async () => ({
      huddle: huddle([ME]),
      participant_id: "p-1",
      answer: { type: "answer", sdp: "remote-answer" },
    })),
    subscribeHuddle: vi.fn(async (_h: string, _p: string, userIds: string[]) => ({
      offer: { type: "offer", sdp: "remote-offer" },
      tracks: userIds.map((user_id, i) => ({ user_id, mid: `${i + 1}` })),
    })),
    renegotiateHuddle: vi.fn(async () => {}),
    unsubscribeHuddle: vi.fn(async () => {}),
    setHuddleMuted: vi.fn(async () => {}),
    leaveHuddle: vi.fn(async () => {}),
  };
  const heartbeat = vi.fn(async (): Promise<"ok" | "gone" | "unsent"> => "ok");
  const setCallRoom = vi.fn();
  const env: CallEnv = {
    api,
    userId: ME,
    getUserMedia: vi.fn(async () => fakeStream()),
    enumerateDevices: vi.fn(async () => [
      { kind: "audioinput", deviceId: "mic-1", label: "内蔵マイク" },
      { kind: "audioinput", deviceId: "mic-2", label: "" },
      { kind: "audiooutput", deviceId: "spk-1", label: "内蔵スピーカー" },
    ] as MediaDeviceInfo[]),
    createPeerConnection: vi.fn(() => {
      const pc = fakePc();
      pcs.push(pc);
      return pc;
    }),
    playAudio: vi.fn((stream: MediaStream) => {
      const sink = { stream, setSpeaker: vi.fn(), detach: vi.fn() };
      sinks.push(sink);
      return sink;
    }),
    canSelectSpeaker: true,
    meter: (stream) => ({ level: () => levels.get(stream) ?? 0, stop: vi.fn() }),
    heartbeat,
    prefs: {
      mic: () => prefs.mic,
      setMic: (id) => void (prefs.mic = id),
      speaker: () => prefs.speaker,
      setSpeaker: (id) => void (prefs.speaker = id),
    },
    setCallRoom,
    now: () => Date.parse("2026-09-26T00:00:00Z"),
    setInterval: (fn) => {
      const id = nextId++;
      intervals.set(id, fn);
      return id;
    },
    clearInterval: (id) => void intervals.delete(id as number),
    setTimeout: (fn) => {
      const id = nextId++;
      timeouts.set(id, fn);
      return id;
    },
    clearTimeout: (id) => void timeouts.delete(id as number),
    ...overrides,
  };
  const call = createHuddleCall(env);
  return {
    call,
    env,
    api,
    heartbeat,
    setCallRoom,
    pcs,
    sinks,
    levels,
    prefs,
    tick: () => [...intervals.values()].forEach((fn) => fn()),
    runTimeouts: () => {
      const pending = [...timeouts.values()];
      timeouts.clear();
      pending.forEach((fn) => fn());
    },
    get intervals() {
      return intervals.size;
    },
  };
}

async function flush() {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

function phase<P extends HuddleCallState["phase"]>(s: HuddleCallState, p: P): Extract<HuddleCallState, { phase: P }> {
  expect(s.phase).toBe(p);
  return s as Extract<HuddleCallState, { phase: P }>;
}

function problem(type: string, status = 409) {
  return new ApiError(status, { type: `${PROBLEM_TYPE_PREFIX}${type}`, title: "", status } as never);
}

async function joined() {
  const t = setup();
  await t.call.openPreview(ROOM);
  await t.call.join();
  await flush();
  return t;
}

describe("参加する前のプレビュー（ADR 0066 追記 B）", () => {
  it("マイクの許可を求め、機器の一覧を出す。名前のない機器には番号を振る", async () => {
    const t = setup();
    await t.call.openPreview(ROOM);
    const s = phase(t.call.getSnapshot(), "preview");
    expect(s.micOn).toBe(true);
    expect(s.micId).toBe("mic-1");
    expect(s.mics).toEqual([
      { id: "mic-1", label: "内蔵マイク" },
      { id: "mic-2", label: "マイク 2" },
    ]);
    expect(s.speakers).toEqual([{ id: "spk-1", label: "内蔵スピーカー" }]);
    expect(t.env.getUserMedia).toHaveBeenCalledWith({
      audio: expect.objectContaining({ echoCancellation: true, noiseSuppression: true, autoGainControl: true }),
    });
  });

  it("スピーカーを選べないブラウザでは、スピーカーの一覧を持たない", async () => {
    const t = setup({ canSelectSpeaker: false });
    await t.call.openPreview(ROOM);
    expect(phase(t.call.getSnapshot(), "preview").speakers).toBeUndefined();
  });

  it("覚えているマイクを使う", async () => {
    const t = setup();
    t.prefs.mic = "mic-2";
    await t.call.openPreview(ROOM);
    expect(t.env.getUserMedia).toHaveBeenCalledWith({ audio: expect.objectContaining({ deviceId: { exact: "mic-2" } }) });
  });

  it.each([
    ["NotAllowedError", "mic-denied"],
    ["NotFoundError", "no-mic"],
  ])("getUserMedia が %s なら %s を出し、開始できない", async (name, want) => {
    const t = setup({ getUserMedia: vi.fn(async () => Promise.reject(new DOMException("", name))) });
    await t.call.openPreview(ROOM);
    expect(phase(t.call.getSnapshot(), "preview").problem).toBe(want);
    await t.call.join();
    expect(t.api.joinHuddle).not.toHaveBeenCalled();
  });

  it("マイクをオフにするとトラックを止め、そのまま入るとミュートで入る", async () => {
    const track = fakeTrack();
    const t = setup({ getUserMedia: vi.fn(async () => fakeStream(track)) });
    await t.call.openPreview(ROOM);
    t.call.toggleMic();
    expect(track.enabled).toBe(false);
    await t.call.join();
    await flush();
    expect(phase(t.call.getSnapshot(), "call").muted).toBe(true);
    expect(t.api.setHuddleMuted).toHaveBeenCalledWith("h-1", "p-1", true);
  });

  it("キャンセルするとマイクを放して idle に戻る", async () => {
    const track = fakeTrack();
    const t = setup({ getUserMedia: vi.fn(async () => fakeStream(track)) });
    await t.call.openPreview(ROOM);
    t.call.cancelPreview();
    expect(t.call.getSnapshot()).toEqual({ phase: "idle" });
    expect(track.stop).toHaveBeenCalled();
  });

  it("選んだ機器を覚える", async () => {
    const t = setup();
    await t.call.openPreview(ROOM);
    await t.call.selectMic("mic-2");
    t.call.selectSpeaker("spk-1");
    expect(t.prefs).toEqual({ mic: "mic-2", speaker: "spk-1" });
    expect(phase(t.call.getSnapshot(), "preview")).toMatchObject({ micId: "mic-2", speakerId: "spk-1" });
  });
});

describe("入る（決定 4）", () => {
  it("TURN を取り、送るだけの transceiver の offer を集め終えてから送り、answer を当てる", async () => {
    const t = await joined();
    const pc = t.pcs[0];
    expect(t.env.createPeerConnection).toHaveBeenCalledWith({
      iceServers: [{ urls: ["turn:turn.example"], username: "u", credential: "c" }],
    });
    expect(pc.addTransceiver).toHaveBeenCalledWith(expect.anything(), { direction: "sendonly" });
    expect(t.api.joinHuddle).toHaveBeenCalledWith(ROOM, { offer: { type: "offer", sdp: "local-offer" }, mid: "0" });
    expect(pc.setRemoteDescription).toHaveBeenCalledWith({ type: "answer", sdp: "remote-answer" });
    expect(phase(t.call.getSnapshot(), "call")).toMatchObject({ huddleId: "h-1", participantId: "p-1", connection: "connecting" });
    // 別のワークスペースを開いても購読を残すよう、ストアに知らせる
    expect(t.setCallRoom).toHaveBeenCalledWith(ROOM);
  });

  it("先に入っている人の音声を、入った直後に受ける", async () => {
    const t = setup();
    t.api.joinHuddle.mockResolvedValueOnce({ huddle: huddle(["u-a", ME]), participant_id: "p-1", answer: { type: "answer", sdp: "a" } });
    await t.call.openPreview(ROOM);
    await t.call.join();
    await flush();
    expect(t.api.subscribeHuddle).toHaveBeenCalledWith("h-1", "p-1", ["u-a"]);
  });

  it("つながったら connected にし、一時的に切れたら reconnecting にする", async () => {
    const t = await joined();
    t.pcs[0].fire("connected");
    expect(phase(t.call.getSnapshot(), "call").connection).toBe("connected");
    t.pcs[0].fire("disconnected");
    expect(phase(t.call.getSnapshot(), "call").connection).toBe("reconnecting");
  });

  it("つなげなかった（failed）ら、抜けて知らせを出す", async () => {
    const t = await joined();
    t.pcs[0].fire("failed");
    await flush();
    expect(t.call.getSnapshot()).toEqual({ phase: "problem", roomId: ROOM, problem: "failed" });
    expect(t.api.leaveHuddle).toHaveBeenCalledWith("h-1", "p-1", { keepalive: false });
    expect(t.pcs[0].close).toHaveBeenCalled();
    expect(t.setCallRoom).toHaveBeenLastCalledWith(null);
  });

  it("20 人を超えたら full を出す", async () => {
    const t = setup();
    t.api.joinHuddle.mockRejectedValueOnce(problem("huddle-full"));
    await t.call.openPreview(ROOM);
    await t.call.join();
    expect(t.call.getSnapshot()).toEqual({ phase: "problem", roomId: ROOM, problem: "full" });
    expect(t.pcs[0].close).toHaveBeenCalled();
  });

  it("入る途中で抜けたら、入れた分をすぐに戻す", async () => {
    const t = setup();
    let resolveJoin!: (v: Awaited<ReturnType<typeof t.api.joinHuddle>>) => void;
    t.api.joinHuddle.mockReturnValueOnce(new Promise((resolve) => (resolveJoin = resolve)));
    await t.call.openPreview(ROOM);
    const joining = t.call.join();
    await flush();
    await t.call.leave();
    resolveJoin({ huddle: huddle([ME]), participant_id: "p-1", answer: { type: "answer", sdp: "a" } });
    await joining;
    expect(t.call.getSnapshot()).toEqual({ phase: "idle" });
    expect(t.api.leaveHuddle).toHaveBeenCalledWith("h-1", "p-1");
  });

  it("TURN の認証情報を、期限の前に取り直して差し替える（決定 14）", async () => {
    const t = await joined();
    t.api.huddleIceServers.mockResolvedValueOnce({
      ice_servers: [{ urls: ["turn:new.example"], username: "u2", credential: "c2" }],
      expires_at: "2026-09-27T00:00:00Z",
    });
    t.runTimeouts();
    await flush();
    expect(t.pcs[0].setConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({ iceServers: [{ urls: ["turn:new.example"], username: "u2", credential: "c2" }] }),
    );
  });
});

describe("受ける音声（決定 9）", () => {
  it("入ってきた人を受け、Cloudflare の offer に answer を返す。届いたトラックを鳴らす", async () => {
    const t = await joined();
    await t.call.sync([ME, "u-a"]);
    const pc = t.pcs[0];
    expect(t.api.subscribeHuddle).toHaveBeenCalledWith("h-1", "p-1", ["u-a"]);
    expect(pc.setRemoteDescription).toHaveBeenLastCalledWith({ type: "offer", sdp: "remote-offer" });
    expect(t.api.renegotiateHuddle).toHaveBeenCalledWith("h-1", "p-1", { type: "answer", sdp: "local-answer" });
    pc.track("1");
    expect(t.sinks).toHaveLength(1);
  });

  it("トラックが subscribe の応答より先に届いても鳴らす", async () => {
    const t = await joined();
    t.pcs[0].track("1");
    expect(t.sinks).toHaveLength(0);
    await t.call.sync([ME, "u-a"]);
    expect(t.sinks).toHaveLength(1);
  });

  it("同じ人は 2 度受けない。続けて呼んでも 1 本の列に並ぶ", async () => {
    const t = await joined();
    await Promise.all([t.call.sync([ME, "u-a"]), t.call.sync([ME, "u-a"]), t.call.sync([ME, "u-a", "u-b"])]);
    expect(t.api.subscribeHuddle.mock.calls.map((c) => c[2])).toEqual([["u-a"], ["u-b"]]);
  });

  it("抜けた人のトラックを閉じ、鳴らすのをやめる", async () => {
    const t = await joined();
    await t.call.sync([ME, "u-a"]);
    t.pcs[0].track("1");
    await t.call.sync([ME]);
    expect(t.api.unsubscribeHuddle).toHaveBeenCalledWith("h-1", "p-1", ["1"]);
    expect(t.sinks[0].detach).toHaveBeenCalled();
  });

  it("変更が重なった（huddle-negotiation-conflict）ら、待ってから 1 回だけやり直す", async () => {
    const t = await joined();
    t.api.subscribeHuddle.mockRejectedValueOnce(problem("huddle-negotiation-conflict"));
    const syncing = t.call.sync([ME, "u-a"]);
    await flush();
    t.runTimeouts();
    await syncing;
    expect(t.api.subscribeHuddle).toHaveBeenCalledTimes(2);
    expect(t.api.renegotiateHuddle).toHaveBeenCalled();
  });

  it("スピーカーを替えると、鳴らしている音声の出力先も替える", async () => {
    const t = await joined();
    await t.call.sync([ME, "u-a"]);
    t.pcs[0].track("1");
    t.call.selectSpeaker("spk-2");
    expect(t.sinks[0].setSpeaker).toHaveBeenCalledWith("spk-2");
  });
});

describe("入っている間", () => {
  it("10 秒ごとに心拍を送る", async () => {
    const t = await joined();
    expect(HEARTBEAT_INTERVAL_MS).toBe(10_000);
    t.tick();
    await flush();
    expect(t.heartbeat).toHaveBeenCalledWith("h-1", "p-1");
  });

  it("心拍で参加がもうないと分かったら、抜けずに片付けて知らせる", async () => {
    const t = await joined();
    t.heartbeat.mockResolvedValue("gone");
    t.tick();
    await flush();
    expect(t.call.getSnapshot()).toEqual({ phase: "problem", roomId: ROOM, problem: "disconnected" });
    expect(t.api.leaveHuddle).not.toHaveBeenCalled();
    expect(t.intervals).toBe(0);
  });

  it("ミュートはブラウザで音を止め、サーバーには印のために知らせる（決定 10）", async () => {
    const track = fakeTrack();
    const t = setup({ getUserMedia: vi.fn(async () => fakeStream(track)) });
    await t.call.openPreview(ROOM);
    await t.call.join();
    await flush();
    t.call.toggleMic();
    await flush();
    expect(track.enabled).toBe(false);
    expect(phase(t.call.getSnapshot(), "call").muted).toBe(true);
    expect(t.api.setHuddleMuted).toHaveBeenCalledWith("h-1", "p-1", true);
  });

  it("通話中にマイクを替えると、送っているトラックを差し替える（SDP のやり取りは要らない）", async () => {
    const t = await joined();
    await t.call.selectMic("mic-2");
    expect(t.pcs[0].sender.replaceTrack).toHaveBeenCalled();
    expect(t.api.renegotiateHuddle).not.toHaveBeenCalled();
  });

  it("話している人は、音量がしきい値を超えた人。ミュートしている自分は数えない", async () => {
    const stream = fakeStream();
    const t = setup({ getUserMedia: vi.fn(async () => stream) });
    await t.call.openPreview(ROOM);
    await t.call.join();
    await flush();
    await t.call.sync([ME, "u-a"]);
    t.pcs[0].track("1");
    t.levels.set(stream, 0.2);
    t.levels.set(t.sinks[0].stream, 0.2);
    expect(SPEAKING_POLL_MS).toBeLessThan(500);
    t.tick();
    expect(phase(t.call.getSnapshot(), "call").speaking).toEqual(["u-a", ME].sort());
    await t.call.setMuted(true);
    t.tick();
    expect(phase(t.call.getSnapshot(), "call").speaking).toEqual(["u-a"]);
  });
});

describe("抜ける・外れる", () => {
  it("抜けると DELETE を送り、接続とマイクを片付ける", async () => {
    const track = fakeTrack();
    const t = setup({ getUserMedia: vi.fn(async () => fakeStream(track)) });
    await t.call.openPreview(ROOM);
    await t.call.join();
    await flush();
    await t.call.leave({ keepalive: true });
    expect(t.api.leaveHuddle).toHaveBeenCalledWith("h-1", "p-1", { keepalive: true });
    expect(t.call.getSnapshot()).toEqual({ phase: "idle" });
    expect(t.pcs[0].close).toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalled();
    expect(t.intervals).toBe(0);
  });

  it.each([
    ["removed", { phase: "problem", roomId: ROOM, problem: "removed" }],
    ["expired", { phase: "problem", roomId: ROOM, problem: "disconnected" }],
    ["moved", { phase: "idle" }],
    ["left", { phase: "idle" }],
  ] as const)("huddle.left（%s）で片付ける。サーバーはもう外しているので DELETE は送らない", async (reason, want) => {
    const t = await joined();
    t.call.receiveLeft({ room_id: ROOM, huddle_id: "h-1", participant_id: "p-1", reason });
    await flush();
    expect(t.call.getSnapshot()).toEqual(want);
    expect(t.api.leaveHuddle).not.toHaveBeenCalled();
  });

  it("ほかの端末の参加の huddle.left は無視する", async () => {
    const t = await joined();
    t.call.receiveLeft({ room_id: ROOM, huddle_id: "h-1", participant_id: "p-other", reason: "moved" });
    expect(t.call.getSnapshot().phase).toBe("call");
  });

  it("知らせを閉じると idle に戻り、もう一度プレビューから入り直せる", async () => {
    const t = await joined();
    t.call.receiveLeft({ room_id: ROOM, huddle_id: "h-1", participant_id: "p-1", reason: "expired" });
    await flush();
    await t.call.openPreview(ROOM);
    expect(t.call.getSnapshot().phase).toBe("preview");
    t.call.cancelPreview();
    await t.call.openPreview(ROOM);
    t.call.dismissProblem();
    expect(t.call.getSnapshot().phase).toBe("preview");
  });
});
