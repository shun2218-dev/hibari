import { vi } from "vitest";

import type { CallEnv } from "@/lib/chat/huddle/call";
import type { HuddleEnvFactory, HuddleWindowOptions } from "@/providers/chat-provider";

/**
 * ハドルの通話に渡す、偽のブラウザの API（lib/chat/huddle/call.ts）。画面のテスト用。
 * マイクとカメラはいつも許可され（画面の共有はない）、RTCPeerConnection は offer と answer を決まった値で返す。心拍と話している人の判定は回さない。
 */
export const fakeCallEnv: HuddleEnvFactory = (base) => {
  const track = { enabled: true, stop: vi.fn(), getSettings: () => ({ deviceId: "mic-1" }) };
  const stream = { getAudioTracks: () => [track], getVideoTracks: () => [], getTracks: () => [track] } as unknown as MediaStream;
  const camera = { enabled: true, stop: vi.fn(), getSettings: () => ({ deviceId: "cam-1" }), addEventListener: () => {} };
  const video = { getAudioTracks: () => [], getVideoTracks: () => [camera], getTracks: () => [camera] } as unknown as MediaStream;
  const env: CallEnv = {
    ...base,
    getUserMedia: async (constraints) => (constraints.video ? video : stream),
    enumerateDevices: async () =>
      [
        { kind: "audioinput", deviceId: "mic-1", label: "内蔵マイク" },
        { kind: "videoinput", deviceId: "cam-1", label: "内蔵カメラ" },
      ] as MediaDeviceInfo[],
    createPeerConnection: () => {
      const pc = {
        iceGatheringState: "complete",
        localDescription: null as RTCSessionDescriptionInit | null,
        signalingState: "stable",
        addTransceiver: () => ({ mid: "0", sender: { replaceTrack: async () => {} }, stop: () => {} }),
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
    prefs: {
      mic: () => undefined,
      setMic: () => {},
      speaker: () => undefined,
      setSpeaker: () => {},
      camera: () => undefined,
      setCamera: () => {},
    },
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
