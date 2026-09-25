import type { HuddleMessageView, HuddleParticipantView, HuddleWindowView, TimelineItem } from "@/components/chat/types";

import { dmTimeline, timeline } from "./timeline";
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

/** 入っている間の窓。自分が先頭。 */
export const huddleWindow: HuddleWindowView = {
  room: channelRoom,
  connection: "connected",
  participants: [{ ...you, muted: false }, ...others],
  joiningSoon: [],
  muted: false,
};

export const huddleWindowMuted: HuddleWindowView = {
  ...huddleWindow,
  participants: [{ ...you, muted: true }, ...others],
  muted: true,
};

export const huddleWindowConnecting: HuddleWindowView = {
  ...huddleWindow,
  connection: "connecting",
  participants: [{ ...you, muted: false }, ...others.map((p) => ({ ...p, speaking: false }))],
};

export const huddleWindowReconnecting: HuddleWindowView = {
  ...huddleWindow,
  connection: "reconnecting",
  participants: [{ ...you, muted: false }, ...others.map((p) => ({ ...p, speaking: false }))],
};

/** DM で自分が始めて、相手（佐藤さん）が「もうすぐ参加する」を押したところ（決定 11）。 */
export const huddleWindowJoiningSoon: HuddleWindowView = {
  room: { kind: "dm", name: users.naoki.name },
  connection: "connected",
  participants: [{ ...you, muted: false }],
  joiningSoon: [naoki],
  muted: false,
};

export const huddleProblemRoom = channelRoom;

/** DM の呼び出し（決定 11）。 */
export const huddleCaller = naoki;

const huddleBase = { key: "h-1120", starter: naoki, timeLabel: "11:20" } as const;

const activeHuddle: HuddleMessageView = { ...huddleBase, state: "active", participants: huddleOthers };

const joinedHuddle: HuddleMessageView = { ...activeHuddle, participants: [you, ...huddleOthers], joined: true };

/** 終わったハドル。名前は自分を含めて 2 人まで、それより多ければ「ほか N 人」（決定 12。オーナーの回答にある Slack の形）。 */
const endedHuddle: HuddleMessageView = {
  ...huddleBase,
  state: "ended",
  participants: [you, naoki, miyuki, ryo, users.misaki],
  participantsLabel: "あなた、佐藤 直樹、ほか 3 人が参加しました",
  durationLabel: "12 分",
};

export const timelineWithHuddle: TimelineItem[] = [...timeline, { type: "huddle", huddle: activeHuddle }];

export const timelineWithHuddleJoined: TimelineItem[] = [...timeline, { type: "huddle", huddle: joinedHuddle }];

export const timelineWithHuddleEnded: TimelineItem[] = [...timeline, { type: "huddle", huddle: endedHuddle }];

/** DM の不在着信（相手が始めて、自分が入らないまま終わった）と、応答なし（自分が始めた）。 */
export const dmTimelineWithMissedHuddle: TimelineItem[] = [
  ...dmTimeline,
  { type: "huddle", huddle: { key: "h-dm-1130", starter: naoki, timeLabel: "11:30", state: "missed", participants: [naoki] } },
  {
    type: "huddle",
    huddle: { key: "h-dm-1142", starter: you, timeLabel: "11:42", state: "unanswered", participants: [you] },
  },
];

/** DM で自分が始めて、相手を待っているところ。 */
export const dmTimelineWithHuddleWaiting: TimelineItem[] = [
  ...dmTimeline,
  {
    type: "huddle",
    huddle: { key: "h-dm-1142", starter: you, timeLabel: "11:42", state: "active", participants: [you], joined: true },
  },
];

/** DM の呼び出しを受けているところ（相手が始めて、自分はまだ入っていない）。 */
export const dmTimelineWithHuddleRinging: TimelineItem[] = [
  ...dmTimeline,
  { type: "huddle", huddle: { key: "h-dm-1142", starter: naoki, timeLabel: "11:42", state: "active", participants: [naoki] } },
];
