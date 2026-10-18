/**
 * 最後に開いたワークスペースと、ワークスペースごとに最後に開いたルーム。
 *
 * `/` と `/w/{id}` を開いたときの行き先に使うだけの、表示の便宜。トークンや本文は置かない
 * （Access Token を localStorage に置かない方針とは別の話。ここにあるのは ID だけ）。
 * 別の人が同じブラウザでログインしても、その人の一覧にない ID は使わないので害はない。
 *
 * localStorage はプライベートウィンドウや設定で使えないことがあるので、読み書きの失敗は無視する。
 */

const KEY = "hibari:last-location";

type LastLocation = { workspaceId?: string; rooms: Record<string, string> };

function read(storage: Storage | undefined): LastLocation {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(KEY) ?? "null");
    if (parsed && typeof parsed === "object") {
      const { workspaceId, rooms } = parsed as Partial<LastLocation>;
      return {
        workspaceId: typeof workspaceId === "string" ? workspaceId : undefined,
        rooms: rooms && typeof rooms === "object" ? rooms : {},
      };
    }
  } catch {
    // 壊れた値や、使えないストレージは「覚えていない」と同じに扱う。
  }
  return { rooms: {} };
}

function write(storage: Storage | undefined, value: LastLocation) {
  try {
    storage?.setItem(KEY, JSON.stringify(value));
  } catch {
    // 書けなくても、次に開いたときに先頭の候補へ行くだけ。
  }
}

function defaultStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function lastWorkspaceId(storage = defaultStorage()): string | undefined {
  return read(storage).workspaceId;
}

export function lastRoomId(workspaceId: string, storage = defaultStorage()): string | undefined {
  return read(storage).rooms[workspaceId];
}

export function rememberLocation(workspaceId: string, roomId: string | undefined, storage = defaultStorage()) {
  const current = read(storage);
  write(storage, {
    workspaceId,
    rooms: roomId ? { ...current.rooms, [workspaceId]: roomId } : current.rooms,
  });
}

/** 開けなかった（メンバーでなくなった、消えた）ワークスペースやルームを忘れる。 */
export function forgetLocation(workspaceId: string, roomId?: string, storage = defaultStorage()) {
  const current = read(storage);
  const rooms = { ...current.rooms };
  if (roomId === undefined || rooms[workspaceId] === roomId) delete rooms[workspaceId];
  write(storage, {
    workspaceId: roomId === undefined && current.workspaceId === workspaceId ? undefined : current.workspaceId,
    rooms,
  });
}
