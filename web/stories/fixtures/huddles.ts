import type {
  HuddleMessageView,
  HuddleParticipantView,
  HuddlePreviewView,
  HuddleScreenView,
  TimelineItem,
} from "@/components/chat/types";

import { dmTimeline, message, messageView, timeline } from "./timeline";
import { users } from "./users";

/**
 * ハドル（ADR 0066。chat/huddle/）。開いているチャンネル（デザインレビュー）で、佐藤 直樹が 11:20 に始めたハドル。
 */

// 既定のタイムライン（fixtures/timeline.ts）と同じく、アバターは頭文字にする
const { you, naoki, miyuki, ryo } = users;

/** 自分が入る前から入っている人。佐藤さんが話していて、高橋さんはミュートしている。 */
const others: HuddleParticipantView[] = [
  { ...naoki, muted: false, speaking: true },
  { ...miyuki, muted: true },
  { ...ryo, muted: false },
];

export const huddleOthers = others.map(({ id, name, avatarUrl }) => ({ id, name, avatarUrl }));

const channelRoom = { kind: "public", name: "デザインレビュー" } as const;

// ---- 参加前のプレビュー（追記 B） ----

const mics = [
  { id: "mic-default", label: "既定 - MacBook Air のマイク" },
  { id: "mic-airpods", label: "AirPods Pro" },
  { id: "mic-usb", label: "USB オーディオデバイス" },
];

const speakers = [
  { id: "spk-default", label: "既定 - MacBook Air のスピーカー" },
  { id: "spk-airpods", label: "AirPods Pro" },
];

export const huddlePreview: HuddlePreviewView = {
  room: channelRoom,
  action: "start",
  self: you,
  micOn: true,
  mics,
  micId: "mic-default",
  speakers,
  speakerId: "spk-default",
};

export const huddlePreviewJoin: HuddlePreviewView = { ...huddlePreview, action: "join", micOn: false };

export const huddlePreviewMicDenied: HuddlePreviewView = { ...huddlePreview, micOn: false, mics: [], micId: undefined, problem: "mic-denied" };

// ---- ハドルの画面（追記 C） ----

export const huddleScreen: HuddleScreenView = {
  room: channelRoom,
  connection: "connected",
  participants: [{ ...you, muted: false }, ...others],
  joiningSoon: [],
  muted: false,
};

export const huddleScreenMuted: HuddleScreenView = {
  ...huddleScreen,
  participants: [{ ...you, muted: true }, ...others],
  muted: true,
};

export const huddleScreenConnecting: HuddleScreenView = {
  ...huddleScreen,
  connection: "connecting",
  participants: [{ ...you, muted: false }, ...others.map((p) => ({ ...p, speaking: false }))],
};

export const huddleScreenReconnecting: HuddleScreenView = {
  ...huddleScreenConnecting,
  connection: "reconnecting",
};

/** DM で自分が始めて、相手（佐藤さん）が「もうすぐ参加する」を押したところ（決定 11）。 */
export const huddleScreenJoiningSoon: HuddleScreenView = {
  room: { kind: "dm", name: users.naoki.name },
  connection: "connected",
  participants: [{ ...you, muted: false }],
  joiningSoon: [naoki],
  muted: false,
};

/** 上限に近い大人数（20 人まで。決定 7）。タイルの並びを見るため。 */
export const huddleScreenCrowded: HuddleScreenView = {
  ...huddleScreen,
  participants: [
    { ...you, muted: false },
    ...others,
    ...(["misaki", "suzuki", "haru", "kei"] as const).map((k, i) => ({ ...users[k], muted: i % 2 === 0 })),
    ...Array.from({ length: 4 }, (_, i) => ({ id: `u-guest-${i}`, name: `メンバー ${i + 1}`, muted: i === 1 })),
  ],
};

export const huddleProblemRoom = channelRoom;

/** DM の呼び出し（決定 11）。 */
export const huddleCaller = naoki;

// ---- 会話のメッセージ（決定 12・追記 D） ----

const huddleBase = { key: "h-1120", starter: naoki, timeLabel: "11:20" } as const;

const activeHuddle: HuddleMessageView = {
  ...huddleBase,
  state: "active",
  participants: huddleOthers,
  participantsLabel: "佐藤 直樹、高橋 みゆき、ほか 1 人が参加中",
  thread: { replyCount: 2, lastReplyLabel: "11:24" },
};

const joinedHuddle: HuddleMessageView = {
  ...activeHuddle,
  participants: [you, ...huddleOthers],
  participantsLabel: "あなた、佐藤 直樹、ほか 2 人",
  joined: true,
};

/** 終わったハドル。名前は自分を含めて 2 人まで、それより多ければ「ほか N 人」（決定 12。オーナーの回答にある Slack の形）。 */
const endedHuddle: HuddleMessageView = {
  ...huddleBase,
  state: "ended",
  participants: [you, naoki, miyuki, ryo, users.misaki],
  participantsLabel: "あなた、佐藤 直樹、ほか 3 人が参加しました",
  durationLabel: "12 分",
  thread: { replyCount: 2, lastReplyLabel: "11:24" },
};

export const huddleMessageKey = huddleBase.key;

export const timelineWithHuddle: TimelineItem[] = [...timeline, { type: "huddle", huddle: activeHuddle }];

export const timelineWithHuddleJoined: TimelineItem[] = [...timeline, { type: "huddle", huddle: joinedHuddle }];

export const timelineWithHuddleEnded: TimelineItem[] = [...timeline, { type: "huddle", huddle: endedHuddle }];

/** ハドルのチャット（ハドルのメッセージのスレッド。追記 A）。親はハドルのメッセージのまま出す。 */
export const huddleChatItems: TimelineItem[] = [
  { type: "huddle", huddle: { ...joinedHuddle, thread: undefined } },
  { type: "thread-divider", key: "divider-h-1120", replyCount: 2 },
  ...[
    message("m-h-1122", miyuki, "11:22", "音声だけ先に確認します。資料はここに貼りますね。"),
    message("m-h-1124", naoki, "11:24", "ありがとうございます。画面の案は 2 案目で進めましょう。"),
  ].map((item): TimelineItem => ({ type: "message", message: messageView(item) })),
];

/** DM の不在着信（相手が始めて、自分が入らないまま終わった）と、応答なし（自分が始めた）。 */
export const dmTimelineWithMissedHuddle: TimelineItem[] = [
  ...dmTimeline,
  { type: "huddle", huddle: { key: "h-dm-1130", starter: naoki, timeLabel: "11:30", state: "missed", participants: [naoki] } },
  {
    type: "huddle",
    huddle: { key: "h-dm-1142", starter: you, timeLabel: "11:42", state: "unanswered", participants: [you] },
  },
];

/** DM の呼び出しを受けているところ（相手が始めて、自分はまだ入っていない）。 */
export const dmTimelineWithHuddleRinging: TimelineItem[] = [
  ...dmTimeline,
  {
    type: "huddle",
    huddle: {
      key: "h-dm-1142",
      starter: naoki,
      timeLabel: "11:42",
      state: "active",
      participants: [naoki],
      participantsLabel: "佐藤 直樹が参加中",
    },
  },
];
