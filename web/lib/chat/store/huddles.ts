import type { HuddleRingingData, HuddleUpdatedData, RoomHuddle } from "@/lib/api/types.gen";
import { isMuted } from "@/lib/chat/notifications/mute";

import type { StoreCore } from "./core";
import { HUDDLE_RING_MS } from "./state";

/**
 * 音声のハドル（ADR 0066）の、画面に出す状態。
 *
 * ルームの進行中のハドルは、ルームの本体（rooms の huddle）に持つ。ルームの一覧と 1 件の取得が REST の正で、
 * huddle.updated は「いまの全体」と版（version）で届く（決定 13）。取りこぼしても次の 1 件で正しくなり、
 * 届く順が入れ替わっても古い版は捨てる。再接続したら、ルームの一覧の取り直しでそろう。
 *
 * 通話そのもの（マイク・WebRTC の接続・心拍）は、ここではなく lib/chat/huddle が持つ。
 */
export function createHuddles(core: StoreCore) {
  const { now, patchRoom, update, userId } = core;
  let ringTimer: ReturnType<typeof setTimeout> | undefined;

  function receiveHuddleUpdated({ room_id, huddle }: HuddleUpdatedData) {
    patchRoom(room_id, (room) => {
      const next = newerHuddle(room.huddle, huddle);
      return next === room.huddle ? room : { ...room, huddle: next };
    });
    // 呼び出しは、ハドルが終わった・自分が（どの端末からでも）入ったら止める（決定 11）
    const ring = core.state.huddleRing;
    if (ring && ring.roomId === room_id) {
      const current = core.state.rooms[room_id]?.huddle ?? null;
      if (current === null || current.id !== ring.huddleId || current.participants.some((p) => p.user_id === userId)) {
        dismissHuddleRing();
      }
    }
  }

  function receiveHuddleRinging({ room_id, huddle_id, caller_id }: HuddleRingingData) {
    if (caller_id === userId) return;
    // ミュートした DM では呼び出さない（決定 11。ADR 0057 の「ミュートでは出さない」と同じ）
    if (isMuted(core.state.rooms[room_id]?.notifications, now())) return;
    clearTimeout(ringTimer);
    // 60 秒で止める（オーナーの判断。Slack の秒数には合わせない）
    ringTimer = setTimeout(dismissHuddleRing, HUDDLE_RING_MS);
    update((s) => ({ ...s, huddleRing: { roomId: room_id, huddleId: huddle_id, callerId: caller_id } }));
  }

  function dismissHuddleRing() {
    clearTimeout(ringTimer);
    ringTimer = undefined;
    update((s) => (s.huddleRing === null ? s : { ...s, huddleRing: null }));
  }

  /** 「もうすぐ参加する」（決定 11）。押したら呼び出しを止め、ハドルにいる人の画面に出す。 */
  async function huddleJoiningSoon(huddleId: string) {
    dismissHuddleRing();
    await core.api.huddleJoiningSoon(huddleId);
  }

  /** このタブで通話しているルーム（state の huddleCallRoomId）。通話を始めたら入れ、終わったら null にする。 */
  function setHuddleCallRoom(roomId: string | null) {
    update((s) => (s.huddleCallRoomId === roomId ? s : { ...s, huddleCallRoomId: roomId }));
  }

  /** 使える機能を読む。失敗したら使えないものとして扱う（ボタンを出さない）。 */
  async function loadFeatures() {
    if (core.state.features !== null) return;
    const features = await core.api.features().catch(() => ({ huddles: false }));
    update((s) => ({ ...s, features }));
  }

  return {
    receiveHuddleUpdated,
    receiveHuddleRinging,
    stop: () => clearTimeout(ringTimer),
    actions: { dismissHuddleRing, huddleJoiningSoon, setHuddleCallRoom, loadFeatures },
  };
}

export type Huddles = ReturnType<typeof createHuddles>;

/**
 * 手元のハドルと届いたハドルのうち、新しい方を返す。
 * - null（終わった）はいつでも受け入れる。終わった後に同じハドルの古い版が届いても、ID が同じなら版で捨てる
 * - 同じハドルなら、版が手元より新しいときだけ受け入れる
 * - 別のハドル（終わって新しく始まった）は受け入れる
 */
export function newerHuddle(current: RoomHuddle | null, incoming: RoomHuddle | null): RoomHuddle | null {
  if (incoming === null) return null;
  if (current !== null && current.id === incoming.id && current.version >= incoming.version) return current;
  return incoming;
}
