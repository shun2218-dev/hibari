import type { HuddleHeaderState, HuddleMessageView, RoomKind, UserRef } from "@/components/chat/types";
import type { MessageHuddle, Room, RoomHuddle, UserProfile } from "@/lib/api/types.gen";

import type { UrlTable } from "./message";

/**
 * 音声のハドル（ADR 0066）の表示用の変換。見る人で変わる見え方（参加中・不在着信・応答なし）は、ここで自分の ID から決める。
 * サーバーは見る人によらない値（始めた人・参加した人・終わった時刻）だけを返す（決定 12）。
 */

/** 自分の名前の代わりに出す言葉。 */
const ME = "あなた";

type Names = Readonly<Record<string, string | undefined>>;

/**
 * 参加した人の名前の並び（決定 12。オーナーの回答にある Slack の形）。
 * 自分がいれば先頭にし、名前は 2 人まで。それより多ければ「ほか N 人」。
 * 例: 「あなた」「あなた、佐藤 直樹」「あなた、佐藤 直樹、ほか 3 人」
 */
export function huddleParticipantNames(userIds: readonly string[], meId: string | undefined, names: Names): string {
  const ordered = meId !== undefined && userIds.includes(meId) ? [meId, ...userIds.filter((id) => id !== meId)] : [...userIds];
  const label = (id: string) => (id === meId ? ME : (names[id] ?? "メンバー"));
  const shown = ordered.slice(0, 2).map(label).join("、");
  const rest = ordered.length - 2;
  return rest > 0 ? `${shown}、ほか ${rest} 人` : shown;
}

/** 所要時間（「12 分」「1 時間 5 分」）。1 分に満たなければ「1 分未満」。 */
export function huddleDurationLabel(startedAt: string, endedAt: string): string {
  const minutes = Math.floor((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 60_000);
  if (minutes < 1) return "1 分未満";
  if (minutes < 60) return `${minutes} 分`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} 時間` : `${h} 時間 ${m} 分`;
}

/**
 * 会話のハドルのメッセージの見え方（決定 12・追記 D）。
 * active は、ルームの進行中のハドル（activeHuddle）がこのメッセージのハドルなら、いま入っている人をそこから出す。
 * そうでなければ（ルームの状態をまだ読んでいない）、一度でも入った人で代える。
 */
export function toHuddleMessageView(
  message: { id: string; sender: UserProfile; huddle: MessageHuddle },
  {
    me,
    roomKind,
    activeHuddle,
    names,
    avatarUrls = {},
    timeLabel,
    thread,
  }: {
    me?: UserProfile;
    roomKind?: RoomKind;
    activeHuddle?: RoomHuddle | null;
    names: Names;
    avatarUrls?: UrlTable;
    timeLabel: string;
    thread?: HuddleMessageView["thread"];
  },
): HuddleMessageView {
  const { huddle, sender } = message;
  const withMe: Names = me ? { ...names, [me.id]: me.display_name, [sender.id]: sender.display_name } : { ...names, [sender.id]: sender.display_name };
  const ref = (id: string): UserRef => ({ id, name: withMe[id] ?? "メンバー", avatarUrl: avatarUrls[id] ?? undefined });
  const starter: UserRef = { id: sender.id, name: sender.display_name, avatarUrl: avatarUrls[sender.id] ?? undefined };
  const base = { key: message.id, starter, timeLabel, thread };

  if (huddle.ended_at === null) {
    const current =
      activeHuddle && activeHuddle.id === huddle.id ? activeHuddle.participants.map((p) => p.user_id) : huddle.participant_ids;
    const joined = me !== undefined && current.includes(me.id);
    const label = huddleParticipantNames(current, me?.id, withMe);
    return {
      ...base,
      state: "active",
      participants: current.map(ref),
      // 自分が入っていれば、部品が「参加中 · 」を前に付ける
      participantsLabel: current.length === 0 ? "" : joined ? label : `${label}が参加中`,
      joined,
    };
  }

  const ids = huddle.participant_ids;
  if (roomKind === "dm" && me !== undefined) {
    // DM で一度も入らなかった人には不在着信、始めた人（相手が入らなかった）には応答なし（決定 12）
    if (!ids.includes(me.id)) return { ...base, state: "missed", participants: ids.map(ref) };
    if (sender.id === me.id && ids.length === 1) return { ...base, state: "unanswered", participants: ids.map(ref) };
  }
  const label = huddleParticipantNames(ids, me?.id, withMe);
  return {
    ...base,
    state: "ended",
    participants: ids.map(ref),
    participantsLabel: ids.length === 1 ? `${label}が 1 人で参加しました` : `${label}が参加しました`,
    durationLabel: huddleDurationLabel(huddle.started_at, huddle.ended_at),
  };
}

/** ヘッダーのハドルのボタンの状態（決定 17・追記 C）。自分が（どの端末からでも）入っていれば joined。 */
export function huddleHeaderState(room: Room, meId: string, names: Names, avatarUrls: UrlTable = {}): HuddleHeaderState {
  const h = room.huddle;
  if (h === null || h.participants.length === 0) return { state: "idle" };
  if (h.participants.some((p) => p.user_id === meId)) return { state: "joined" };
  return {
    state: "active",
    participants: h.participants.map((p) => ({ id: p.user_id, name: names[p.user_id] ?? "メンバー", avatarUrl: avatarUrls[p.user_id] ?? undefined })),
  };
}

/** サイドバーの行のハドルの印（顔・ヘッドフォン・人数）。進行中でなければ undefined。 */
export function roomHuddleBadge(room: Room, names: Names, avatarUrls: UrlTable = {}): { participants: UserRef[] } | undefined {
  const h = room.huddle;
  if (h === null || h.participants.length === 0) return undefined;
  return {
    participants: h.participants.map((p) => ({ id: p.user_id, name: names[p.user_id] ?? "メンバー", avatarUrl: avatarUrls[p.user_id] ?? undefined })),
  };
}
