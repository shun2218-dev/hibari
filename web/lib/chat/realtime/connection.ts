import { ApiError } from "@/lib/api/error";
import type { Ack, ClientMessage, ServerEvent, ServerMessage } from "@/lib/api/types.gen";

/** ブラウザの WebSocket のうち、ここで使う部分。テストでは偽物を渡す。 */
export type SocketLike = {
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  send(data: string): void;
  close(code?: number): void;
};

/**
 * - connecting: 最初の接続を試している（まだ一度も切れていない）
 * - open: 接続している
 * - reconnecting: 切れて、つなぎ直そうとしている
 * - closed: 止めた、またはセッションが失効して、もうつながない
 */
export type ConnectionStatus = "connecting" | "open" | "reconnecting" | "closed";

export type ConnectionState = {
  status: ConnectionStatus;
  /** 最後に接続できた時刻（ミリ秒）。一度も接続していなければ null。 */
  lastOpenedAt: number | null;
  /**
   * 最後に接続してから続けて、サーバーに届かなかった（ticket の発行が通信の失敗か 502 / 503 / 504 になった）試行の数。
   * 端末がオフラインの間の失敗は数えない（それはサーバーの問題ではない）。
   */
  unreachableAttempts: number;
};

export type ConnectionOptions = {
  /** `ws(s)://.../api/v1/ws`。ticket はクエリに足す。 */
  url: string;
  /** `POST /api/v1/ws/ticket` の ticket。再接続のたびに発行し直す（1 回しか使えず、30 秒で切れる）。 */
  issueTicket: () => Promise<string>;
  /** セッションがまだ有効かを refresh で確かめる（session.revalidate）。 */
  revalidateSession: () => Promise<boolean>;
  createSocket: (url: string) => SocketLike;
  /** 接続するたびに呼ぶ。購読と同期は呼ぶ側が行う。 */
  onOpen: () => void;
  onEvent: (event: ServerEvent) => void;
  onStateChange: (state: ConnectionState) => void;
  now?: () => number;
  random?: () => number;
  /** 端末がネットワークにつながっているか（navigator.onLine）。 */
  isOnline?: () => boolean;
  /** online / offline の通知を購読する。解除する関数を返す。 */
  watchNetwork?: (handlers: { online: () => void; offline: () => void }) => () => void;
};

/** 再接続の待ち時間の上限の初期値と最大値。試すたびに倍にする。 */
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;

/** この時間より長く接続できていたら、切れたときに待ち時間を初期値に戻す。すぐ切られる接続で、待ち時間が縮み続けないように。 */
const STABLE_CONNECTION_MS = 30_000;

/**
 * アプリケーションの ping の間隔と、ack を待つ時間。
 * サーバーの WebSocket の ping（30 秒ごと）はブラウザの JS から見えないので、スリープの復帰や経路の断で
 * 接続が黙って死んだことに気づけない。ping の ack が返らなければ、切れたとみなしてつなぎ直す。
 */
const HEARTBEAT_INTERVAL_MS = 25_000;
const HEARTBEAT_TIMEOUT_MS = 10_000;

/** セッションが失効した（docs/events.md）。再接続せず、refresh で確かめる。 */
const CLOSE_SESSION_REVOKED = 4001;

export class ConnectionClosedError extends Error {
  constructor() {
    super("websocket connection closed");
  }
}

/**
 * WebSocket の接続を 1 本持ち、切れたらつなぎ直す。
 *
 * - 接続のたびに ws-ticket を発行する（Access Token を URL に載せない。CLAUDE.md）
 * - 切れたら指数バックオフ + フルジッター（0〜上限のランダム）で待つ。サーバーが落ちたときに全員が同時につなぎ直さないように
 * - close コード 4001 はセッションの失効なので、refresh で確かめる。失効していればもうつながない（session が signed_out になる）
 * - 購読・同期・イベントの意味は知らない。接続の上に乗るもの（realtime.ts）が onOpen と onEvent で扱う
 */
export function createConnection({
  url,
  issueTicket,
  revalidateSession,
  createSocket,
  onOpen,
  onEvent,
  onStateChange,
  now = Date.now,
  random = Math.random,
  isOnline = () => typeof navigator === "undefined" || navigator.onLine,
  watchNetwork = watchWindowNetwork,
}: ConnectionOptions) {
  let state: ConnectionState = { status: "closed", lastOpenedAt: null, unreachableAttempts: 0 };
  let started = false;
  // 試行ごとに増やす。止めた後や、別の試行が始まった後に届いた古い結果を無視するため
  let generation = 0;
  let socket: SocketLike | undefined;
  let openedAt: number | undefined;
  let backoffAttempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
  let heartbeatTimeout: ReturnType<typeof setTimeout> | undefined;
  let unwatchNetwork: (() => void) | undefined;
  let nextId = 0;
  const pending = new Map<string, { resolve: (ack: Ack) => void; reject: (err: Error) => void }>();

  function setState(patch: Partial<ConnectionState>) {
    state = { ...state, ...patch };
    onStateChange(state);
  }

  function clearTimers() {
    clearTimeout(retryTimer);
    clearTimeout(heartbeatTimer);
    clearTimeout(heartbeatTimeout);
    retryTimer = heartbeatTimer = heartbeatTimeout = undefined;
  }

  function rejectPending() {
    for (const { reject } of pending.values()) reject(new ConnectionClosedError());
    pending.clear();
  }

  /** 手元の接続を捨てる。ハンドラを外してから閉じるので、この後に onclose は呼ばれない。 */
  function dropSocket() {
    if (!socket) return;
    const s = socket;
    socket = undefined;
    s.onopen = s.onmessage = s.onclose = s.onerror = null;
    try {
      s.close();
    } catch {
      // 接続の途中で閉じると投げる実装がある。捨てるだけなので無視する
    }
    rejectPending();
  }

  function scheduleRetry() {
    if (!started) return;
    const cap = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** backoffAttempt);
    backoffAttempt++;
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => void attempt(), random() * cap);
  }

  function handleClose(code: number) {
    if (openedAt !== undefined && now() - openedAt >= STABLE_CONNECTION_MS) backoffAttempt = 0;
    openedAt = undefined;
    clearTimers();
    dropSocket();
    if (!started) return;
    setState({ status: "reconnecting" });

    if (code !== CLOSE_SESSION_REVOKED) {
      scheduleRetry();
      return;
    }
    const gen = ++generation;
    revalidateSession().then(
      (valid) => {
        if (gen !== generation) return;
        if (valid) scheduleRetry();
        else stop();
      },
      () => {
        if (gen === generation) scheduleRetry();
      },
    );
  }

  function startHeartbeat() {
    heartbeatTimer = setTimeout(() => {
      heartbeatTimeout = setTimeout(() => handleClose(1006), HEARTBEAT_TIMEOUT_MS);
      request({ type: "ping" }).then(
        () => {
          clearTimeout(heartbeatTimeout);
          startHeartbeat();
        },
        // 切れたときは handleClose が済ませている
        () => {},
      );
    }, HEARTBEAT_INTERVAL_MS);
  }

  function handleMessage(data: unknown) {
    let message: ServerMessage;
    try {
      message = JSON.parse(String(data)) as ServerMessage;
    } catch {
      console.error("received a websocket frame that is not JSON");
      return;
    }
    if (message.type === "ack") {
      if (message.id === undefined) {
        // id のないメッセージ（typing）の失敗。送る側は結果を待っていない
        console.warn("websocket message failed", message.error);
        return;
      }
      const waiter = pending.get(message.id);
      pending.delete(message.id);
      waiter?.resolve(message);
      return;
    }
    onEvent(message);
  }

  async function attempt() {
    if (!started) return;
    clearTimeout(retryTimer);
    const gen = ++generation;
    if (state.status === "closed") setState({ status: "connecting" });

    let ticket: string;
    try {
      ticket = await issueTicket();
    } catch (err) {
      if (gen !== generation) return;
      if (err instanceof ApiError && err.status === 401) {
        // session.request が refresh も試して、signed_out にしている
        stop();
        return;
      }
      const unreachable = !(err instanceof ApiError) || err.status === 502 || err.status === 503 || err.status === 504;
      setState({
        status: "reconnecting",
        unreachableAttempts: state.unreachableAttempts + (unreachable && isOnline() ? 1 : 0),
      });
      scheduleRetry();
      return;
    }
    if (gen !== generation) return;

    dropSocket();
    const s = createSocket(`${url}?ticket=${encodeURIComponent(ticket)}`);
    socket = s;
    s.onopen = () => {
      openedAt = now();
      setState({ status: "open", lastOpenedAt: openedAt, unreachableAttempts: 0 });
      startHeartbeat();
      onOpen();
    };
    s.onmessage = (event) => handleMessage(event.data);
    // ticket が使えない（401）ときも、ブラウザにはアップグレードの失敗（1006）としか見えない
    s.onclose = (event) => handleClose(event.code);
    s.onerror = null;
  }

  function send(message: ClientMessage) {
    if (!socket || state.status !== "open") throw new ConnectionClosedError();
    socket.send(JSON.stringify(message));
  }

  /** id を付けて送り、同じ id の ack を待つ。接続が切れたら ConnectionClosedError で失敗する。 */
  function request(message: Omit<ClientMessage, "id">): Promise<Ack> {
    const id = `c${++nextId}`;
    return new Promise<Ack>((resolve, reject) => {
      // 送る前に待ち受けを置く。ack が送信と同じタスクの中で届いても取りこぼさない
      pending.set(id, { resolve, reject });
      try {
        send({ ...message, id });
      } catch (err) {
        pending.delete(id);
        reject(err);
      }
    });
  }

  function stop() {
    if (!started) return;
    started = false;
    generation++;
    clearTimers();
    dropSocket();
    unwatchNetwork?.();
    unwatchNetwork = undefined;
    openedAt = undefined;
    setState({ status: "closed" });
  }

  return {
    getState(): ConnectionState {
      return state;
    },

    start() {
      if (started) return;
      started = true;
      backoffAttempt = 0;
      unwatchNetwork = watchNetwork({
        // 復帰したら待たずにつなぎ直す
        online: () => {
          if (started && !socket) void attempt();
        },
        // ブラウザは経路が切れても接続をすぐには閉じない。オフラインになったら切れたとみなす
        offline: () => {
          if (socket) handleClose(1006);
        },
      });
      void attempt();
    },

    stop,

    /** 待ち時間を飛ばして、いますぐつなぎ直す（「再試行」ボタン）。 */
    retryNow() {
      if (!started || socket) return;
      void attempt();
    },

    request,

    /** 結果を待たないメッセージ（typing）。つながっていなければ何もしない。 */
    notify(message: Omit<ClientMessage, "id">) {
      try {
        send(message);
      } catch {
        // typing は落ちてよい
      }
    },
  };
}

export type Connection = ReturnType<typeof createConnection>;

function watchWindowNetwork({ online, offline }: { online: () => void; offline: () => void }): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("online", online);
  window.addEventListener("offline", offline);
  return () => {
    window.removeEventListener("online", online);
    window.removeEventListener("offline", offline);
  };
}

/** API のベース URL（http(s)）から WebSocket の URL を作る。 */
export function webSocketUrl(apiBaseUrl: string): string {
  return `${apiBaseUrl.replace(/^http/, "ws")}/api/v1/ws`;
}
