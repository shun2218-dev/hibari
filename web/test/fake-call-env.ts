import { vi } from "vitest";

import type { CallEnv } from "@/lib/chat/huddle/call";
import type { HuddleEnvFactory, HuddleWindowOptions } from "@/providers/chat-provider";

/**
 * 音声のハドルの通話に渡す、偽のブラウザの API（lib/chat/huddle/call.ts）。画面のテスト用。
 * マイクはいつも許可され、RTCPeerConnection は offer と answer を決まった値で返す。心拍と話している人の判定は回さない。
 */
export const fakeCallEnv: HuddleEnvFactory = (base) => {
  const track = { enabled: true, stop: vi.fn(), getSettings: () => ({ deviceId: "mic-1" }) };
  const stream = { getAudioTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream;
  const env: CallEnv = {
    ...base,
    getUserMedia: async () => stream,
    enumerateDevices: async () => [{ kind: "audioinput", deviceId: "mic-1", label: "内蔵マイク" }] as MediaDeviceInfo[],
    createPeerConnection: () => {
      const pc = {
        iceGatheringState: "complete",
        localDescription: null as RTCSessionDescriptionInit | null,
        addTransceiver: () => ({ mid: "0", sender: { replaceTrack: async () => {} } }),
        createOffer: async () => ({ type: "offer", sdp: "offer" }),
        createAnswer: async () => ({ type: "answer", sdp: "answer" }),
        setLocalDescription: async (d: RTCSessionDescriptionInit) => {
          pc.localDescription = d;
        },
        setRemoteDescription: async () => {},
        setConfiguration: () => {},
        getConfiguration: () => ({}),
        close: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
      };
      return pc as unknown as RTCPeerConnection;
    },
    playAudio: () => ({ setSpeaker: () => {}, detach: () => {} }),
    canSelectSpeaker: false,
    meter: () => ({ level: () => 0, stop: () => {} }),
    prefs: { mic: () => undefined, setMic: () => {}, speaker: () => undefined, setSpeaker: () => {} },
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout: () => 0,
    clearTimeout: () => {},
    now: Date.now,
  };
  return env;
};

/** タブを開かず、同じタブの全画面に出す（jsdom では別のタブを描けない）。 */
export const overlayOnly: HuddleWindowOptions = { open: () => null, preferOverlay: () => true };
