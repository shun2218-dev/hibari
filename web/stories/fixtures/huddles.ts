import type { HuddlePlaceOption } from "@/components/chat/huddle-list";
import type { NewHuddleCandidate } from "@/components/chat/dialogs/new-huddle";
import type {
  HuddleLinkCardView,
  HuddleListItemView,
  HuddleMessageView,
  HuddleOngoingCardView,
  HuddleParticipantView,
  HuddlePreviewView,
  HuddleScreenView,
  HuddleSuggestionView,
  ProfileView,
  RoomMemberView,
  SavedItemView,
  TimelineItem,
  UserStatusView,
} from "@/components/chat/types";

import { dmTimeline, message, messageView, timeline } from "./timeline";
import { dmCandidates } from "./rooms";
import { mockAvatars, statuses, users } from "./users";

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

// ---- ハドルの一覧・ハドル中の印・ハドルへのリンク（ADR 0067。Phase 6.18c） ----

/** 進行中のハドルのカード。自分が入っている #デザインレビュー と、入っていない DM。 */
export const huddleOngoingCards: HuddleOngoingCardView[] = [
  { key: "room-design", room: channelRoom, elapsedLabel: "12 分", participants: [you, ...huddleOthers], joined: true },
  { key: "dm-miyuki", room: { kind: "dm", name: users.miyuki.name }, elapsedLabel: "数秒", participants: [miyuki], joined: false },
];

/** 提案のカード（過去 7 日間に自分が参加した回数の多い場所）。 */
export const huddleSuggestions: HuddleSuggestionView[] = [
  { key: "room-release", room: { kind: "private", name: "リリース準備" }, count: 3, participants: [naoki, ryo, users.misaki] },
];

/** 最近のハドルミーティング（終わったもの。新しい順）。参加しなかったものを混ぜる（`all` の範囲）。 */
export const huddleListItems: HuddleListItemView[] = [
  {
    key: "h-0926-1605",
    href: "#",
    threadHref: "#",
    room: { kind: "private", name: "リリース準備" },
    timeLabel: "23 時間前",
    durationLabel: "2 分",
    replyCount: 1,
    participants: [you, naoki],
    saved: false,
  },
  {
    key: "h-0926-1130",
    href: "#",
    threadHref: "#",
    room: channelRoom,
    timeLabel: "昨日 11:30",
    durationLabel: "38 分",
    replyCount: 6,
    participants: [you, naoki, miyuki, ryo, users.misaki, users.kei],
    saved: true,
  },
  {
    key: "h-0925-1820",
    href: "#",
    threadHref: "#",
    room: { kind: "dm", name: users.naoki.name },
    timeLabel: "9月25日",
    durationLabel: "5 分",
    replyCount: 0,
    participants: [naoki, you],
    saved: false,
  },
  {
    key: "h-0924-1000",
    href: "#",
    threadHref: "#",
    room: { kind: "public", name: "雑談" },
    timeLabel: "9月24日",
    durationLabel: "1 時間 4 分",
    replyCount: 0,
    participants: [miyuki, ryo],
    saved: false,
  },
];

/** 「参加しなかったハドルミーティング」に絞ったところ（自分がいない行だけ）。 */
export const huddleListMissed = huddleListItems.filter((item) => !item.participants.some((p) => p.id === you.id));

/** 「相手」で佐藤さんを選んだところ。 */
export const huddleListWithNaoki = huddleListItems.filter((item) => item.participants.some((p) => p.id === naoki.id));

export const huddleFilterPerson = naoki;

export const huddlePersonOptions = [naoki, miyuki, ryo, { id: users.misaki.id, name: users.misaki.name }];

export const huddlePlaceOptions: HuddlePlaceOption[] = [
  { id: "room-design", room: channelRoom },
  { id: "room-release", room: { kind: "private", name: "リリース準備" } },
  { id: "room-chat", room: { kind: "public", name: "雑談" } },
  { id: "dm-naoki", room: { kind: "dm", name: users.naoki.name } },
];

/** 「…」を開く行と、参加者を出す行。 */
export const huddleListMenuKey = "h-0926-1605";

/** 新規ハドルミーティングの候補（まだ何も打っていない。人とチャンネルが混ざる）。 */
export const newHuddleCandidates: NewHuddleCandidate[] = [
  ...dmCandidates.map((user): NewHuddleCandidate => ({ kind: "user", id: user.id, user })),
  { kind: "room", id: "room-design", room: channelRoom },
  { kind: "room", id: "room-release", room: { kind: "private", name: "リリース準備" } },
];

/** 「さ」と打ったところ。 */
export const newHuddleTyped: NewHuddleCandidate[] = [
  { kind: "user", id: users.naoki.id, user: dmCandidates[0] },
  { kind: "room", id: "room-sakura", room: { kind: "public", name: "さくら-プロジェクト" } },
];

// ---- ハドル中の印（決定 4） ----

type MemberProfile = Extract<ProfileView, { kind: "member" }>;

/** ハドル中の 🎧（本人のステータスがないとき）。lib/chat/presence.ts の displayStatus と同じ値。 */
export const huddleStatus: UserStatusView = { emoji: "🎧", text: "ハドルミーティング中" };

/**
 * ハドル中の人が混ざったメンバーパネル。佐藤さんはステータス（📅 会議中）があるのでステータスのまま、
 * 中村さんはステータスがないので 🎧。高橋さんはハドルに入っていない（ステータスは 🎧 と紛らわしいので外す）。
 */
export const roomMembersInHuddle: RoomMemberView[] = [
  { ...naoki, status: statuses[users.naoki.id], presence: "online", roleLabel: "オーナー" },
  { ...miyuki, presence: "online", roleLabel: "管理者" },
  { ...you, status: huddleStatus, presence: "online", roleLabel: "メンバー" },
  { ...ryo, status: huddleStatus, presence: "online", roleLabel: "メンバー" },
];

/** ステータスを設定している人のハドル中（カードにだけ「ハドルミーティング中」の行が出る）。 */
export const profileInHuddleWithStatus: MemberProfile = {
  kind: "member",
  user: { ...users.naoki, avatarUrl: mockAvatars.naoki, status: statuses[users.naoki.id] },
  presence: "online",
  role: "owner",
  email: { state: "none" },
  isSelf: false,
  inHuddle: true,
};

/** ステータスのない人のハドル中（名前の横が 🎧）。 */
export const profileInHuddle: MemberProfile = {
  kind: "member",
  user: { ...users.ryo },
  presence: "online",
  role: "member",
  email: { state: "none" },
  isSelf: false,
  inHuddle: true,
};

// ---- ハドルへのリンク（決定 1・2） ----

/** 本文に貼られたハドルのリンクのカード（4 つの状態）。 */
const huddleLinkCards: Record<"idle" | "live" | "joined" | "unavailable", HuddleLinkCardView> = {
  idle: { key: "hl-release", state: "ok", room: { kind: "private", name: "リリース準備" }, huddle: null, canJoin: true },
  live: { key: "hl-chat", state: "ok", room: { kind: "public", name: "雑談" }, huddle: { participants: [miyuki, ryo], joined: false }, canJoin: true },
  joined: { key: "hl-design", state: "ok", room: channelRoom, huddle: { participants: [you, ...huddleOthers], joined: true }, canJoin: true },
  unavailable: { key: "hl-gone", state: "unavailable" },
};

/** ハドルのリンクを貼ったメッセージのタイムライン（進行中でない・進行中・参加中・読めない）。 */
export const timelineWithHuddleLinks: TimelineItem[] = [
  ...timeline,
  message("m-hl-1", naoki, "11:40", "15 時からここで打ち合わせしましょう https://hibari.example/w/ws/r/room-release?huddle=1", {
    huddleLinkCards: [huddleLinkCards.idle],
  }),
  message("m-hl-2", miyuki, "11:41", "雑談のハドル、いま誰でもどうぞ https://hibari.example/w/ws/r/room-chat?huddle=1", {
    huddleLinkCards: [huddleLinkCards.live],
  }),
  message("m-hl-3", ryo, "11:42", "レビューはこちらでやってます https://hibari.example/w/ws/r/room-design?huddle=1", {
    huddleLinkCards: [huddleLinkCards.joined],
  }),
  message("m-hl-4", naoki, "11:43", "別のチームの打ち合わせ https://hibari.example/w/ws2/r/room-other?huddle=1", {
    huddleLinkCards: [huddleLinkCards.unavailable],
  }),
];

/** 「後で」に保存したハドルのメッセージ（ハドルの一覧の「ブックマークする」。決定 6）。先頭に足す。 */
export const savedHuddle: SavedItemView = {
  key: "h-0926-1130",
  status: "ok",
  href: "#",
  room: channelRoom,
  sender: naoki,
  timeLabel: "昨日 11:30",
  body: "",
  attachmentCount: 0,
  huddle: { title: "ハドルミーティングは終了しました", detail: "38 分 · あなた、佐藤 直樹、ほか 4 人が参加しました" },
};

/** 参加していない public のチャンネルのリンクから開いたプレビュー / アーカイブしたチャンネル。 */
export const huddlePreviewNotMember: HuddlePreviewView = { ...huddlePreview, room: { kind: "public", name: "雑談" }, action: "join", blocked: "not-member" };

export const huddlePreviewArchived: HuddlePreviewView = { ...huddlePreview, room: { kind: "public", name: "旧プロジェクト" }, blocked: "archived" };
