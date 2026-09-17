import { type ConnectionOptions, type ConnectionState, createConnection } from "./connection";
import type { ChatState, ChatStore, ConnectionView } from "./store";

export type RealtimeOptions = Pick<ConnectionOptions, "url" | "createSocket" | "revalidateSession" | "issueTicket"> &
  Partial<Pick<ConnectionOptions, "now" | "random" | "isOnline" | "watchNetwork">> & {
    store: ChatStore;
  };

/** 「接続が復帰しました」を出しておく時間。 */
const RESTORED_BANNER_MS = 3_000;

/** サーバーに届かない試行がこの回数続いたら、バナーではなく「サーバーに接続できません」の画面にする。 */
const UNAVAILABLE_AFTER_ATTEMPTS = 3;

type Target = { kind: "workspace" | "room"; id: string };

function keyOf(target: Target): string {
  return `${target.kind}:${target.id}`;
}

/** 表示中のワークスペースと、そのサイドバーのルーム（参加中と、読める public）。外されたものは購読しない。 */
function desiredTargets(state: ChatState): Target[] {
  const workspaceId = state.activeWorkspaceId;
  if (!workspaceId || state.removedWorkspaces[workspaceId]) return [];
  const targets: Target[] = [{ kind: "workspace", id: workspaceId }];
  const list = state.roomLists[workspaceId];
  if (list?.status === "ready") {
    for (const id of list.ids) if (!state.removedRooms[id]) targets.push({ kind: "room", id });
  }
  return targets;
}

/**
 * WebSocket の接続の上で、購読と同期を行う（docs/events.md「同期」）。
 *
 * - 接続したら、表示中のワークスペースとサイドバーのルームを購読し、ack を待ってから REST で取り直す。
 *   **購読を先にする**。REST を先に読むと、読み終わってから購読するまでの変更を取りこぼす
 * - 表示が変わったら（ワークスペースの切り替え、ルームの追加）、足りない購読を足し、要らない購読を外す。
 *   新しく購読したルームも、同じく ack の後に取り直す
 * - 再接続では購読がすべて外れているので、全部を購読し直して取り直す。その間は「同期しています」を出す
 */
export function createRealtime({ store, ...connectionOptions }: RealtimeOptions) {
  // いまの接続で購読できたもの / 購読中のもの / 購読できなかったもの（同じ接続では試し直さない）
  let subscribed = new Set<string>();
  let subscribing = new Set<string>();
  let failed = new Set<string>();
  // 購読して取り直している最中のまとまりの数。0 になるまで「同期しています」を消さない
  let batches = 0;
  let everOpened = false;
  let syncingAfterReconnect = false;
  let reconcileScheduled = false;
  let restoredTimer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribeStore: (() => void) | undefined;
  let connectionState: ConnectionState = { status: "closed", lastOpenedAt: null, unreachableAttempts: 0 };

  const connection = createConnection({
    ...connectionOptions,
    onOpen: handleOpen,
    onEvent: (event) => store.applyEvent(event),
    onStateChange: handleConnectionState,
  });

  function setBanner(view: ConnectionView) {
    store.setConnection(view);
  }

  function handleConnectionState(next: ConnectionState) {
    connectionState = next;
    if (next.status === "open") return; // 同期の状態は handleOpen が決める
    clearTimeout(restoredTimer);
    syncingAfterReconnect = false;
    subscribed = new Set();
    subscribing = new Set();
    failed = new Set();
    batches = 0;
    if (next.status === "reconnecting") {
      const unavailable =
        next.lastOpenedAt !== null && next.unreachableAttempts >= UNAVAILABLE_AFTER_ATTEMPTS
          ? { lastConnectedAt: next.lastOpenedAt, retryCount: next.unreachableAttempts }
          : null;
      setBanner({ banner: "reconnecting", unavailable });
    } else {
      setBanner({ banner: null, unavailable: null });
    }
  }

  function handleOpen() {
    clearTimeout(restoredTimer);
    // 最初の接続では、ページが REST で読み込んでいる最中なので、バナーを出さない
    syncingAfterReconnect = everOpened;
    everOpened = true;
    setBanner({ banner: syncingAfterReconnect ? "syncing" : null, unavailable: null });
    void reconcile();
  }

  function scheduleReconcile() {
    if (reconcileScheduled) return;
    reconcileScheduled = true;
    queueMicrotask(() => {
      reconcileScheduled = false;
      void reconcile();
    });
  }

  async function reconcile() {
    if (connectionState.status !== "open") return;
    const state = store.getSnapshot();
    const desired = desiredTargets(state);
    const desiredKeys = new Set(desired.map(keyOf));

    for (const key of subscribed) {
      if (desiredKeys.has(key)) continue;
      subscribed.delete(key);
      const [kind, id] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
      connection
        .request(kind === "workspace" ? { type: "unsubscribe", workspace_id: id } : { type: "unsubscribe", room_id: id })
        .catch(() => {}); // 切れたら購読ごと消えている
    }

    const added = desired.filter((t) => {
      const key = keyOf(t);
      return !subscribed.has(key) && !subscribing.has(key) && !failed.has(key);
    });
    if (added.length === 0) {
      finishReconnectSync();
      return;
    }

    const generation = subscribed;
    const workspaceId = state.activeWorkspaceId!;
    batches++;
    for (const target of added) subscribing.add(keyOf(target));
    const results = await Promise.all(added.map(subscribe));
    // 待っている間に切れた（購読の集合が作り直された）
    if (generation !== subscribed) return;

    const ok = added.filter((_, i) => results[i] === "ok");
    if (results.includes("not_found")) {
      // 読めなくなった（外された、削除された）。一覧を取り直すと消える
      await store.reloadRooms(workspaceId);
    } else if (ok.length > 0) {
      await syncAfterSubscribe(workspaceId, ok);
    }
    if (generation !== subscribed) return;
    batches--;
    // 取り直した一覧に新しいルームがあれば、続けて購読する。なければ同期を終える
    scheduleReconcile();
  }

  async function subscribe(target: Target): Promise<"ok" | "not_found" | "failed"> {
    const key = keyOf(target);
    try {
      const ack = await connection.request(
        target.kind === "workspace"
          ? { type: "subscribe", workspace_id: target.id }
          : { type: "subscribe", room_id: target.id },
      );
      subscribing.delete(key);
      if (ack.error) {
        failed.add(key);
        if (ack.error === "not_found") return "not_found";
        console.error("failed to subscribe", target.kind, ack.error);
        return "failed";
      }
      subscribed.add(key);
      return "ok";
    } catch {
      // 接続が切れた。再接続で購読し直す
      subscribing.delete(key);
      return "failed";
    }
  }

  /** 購読できたものについて、購読より前の変更を REST で取り直す。 */
  async function syncAfterSubscribe(workspaceId: string, targets: Target[]) {
    const state = store.getSnapshot();
    const tasks: Promise<void>[] = [store.reloadRooms(workspaceId)];
    for (const { kind, id } of targets) {
      if (kind !== "room") continue;
      if (state.timelines[id]?.status === "ready") tasks.push(store.syncTimeline(id));
      // メンバー一覧（presence を含む）は、開いているルームの分だけ取り直す。ほかはパネルを開いたときに取る
      if (state.focus?.roomId === id && state.roomMembers[id]) tasks.push(store.loadRoomMembers(id));
    }
    await Promise.all(tasks);
  }

  function finishReconnectSync() {
    if (!syncingAfterReconnect || batches > 0) return;
    syncingAfterReconnect = false;
    setBanner({ banner: "restored", unavailable: null });
    restoredTimer = setTimeout(() => setBanner({ banner: null, unavailable: null }), RESTORED_BANNER_MS);
  }

  return {
    start() {
      unsubscribeStore ??= store.subscribe(scheduleReconcile);
      connection.start();
    },

    stop() {
      unsubscribeStore?.();
      unsubscribeStore = undefined;
      clearTimeout(restoredTimer);
      connection.stop();
    },

    /** 「再試行」ボタン。 */
    retryNow() {
      connection.retryNow();
    },
  };
}

export type Realtime = ReturnType<typeof createRealtime>;
