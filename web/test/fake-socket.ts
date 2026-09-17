import type { ClientMessage, ServerMessage } from "@/lib/api/types.gen";
import type { SocketLike } from "@/lib/chat/connection";

/** サーバーの役をテストが演じる WebSocket。 */
export class FakeSocket implements SocketLike {
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readonly sent: ClientMessage[] = [];
  closed = false;

  constructor(
    readonly url: string,
    private readonly autoAck: boolean,
  ) {}

  send(data: string) {
    const message = JSON.parse(data) as ClientMessage;
    this.sent.push(message);
    if (this.autoAck && message.id) this.receive({ type: "ack", id: message.id });
  }

  close() {
    this.closed = true;
  }

  // ---- サーバー側の操作 ----

  open() {
    this.onopen?.(new Event("open"));
  }

  receive(message: ServerMessage) {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(message) }));
  }

  serverClose(code: number) {
    this.closed = true;
    this.onclose?.(new CloseEvent("close", { code }));
  }

  /** 送られたメッセージのうち、ping を除いたもの（id も除く）。 */
  messages(): Omit<ClientMessage, "id">[] {
    return this.sent
      .filter((m) => m.type !== "ping")
      .map((m) => {
        const rest = { ...m };
        delete rest.id;
        return rest;
      });
  }
}

/**
 * 作られた FakeSocket を順に記録する createSocket。
 * autoAck なら、id の付いたメッセージにすぐ成功の ack を返す（購読を待つテストを短くする）。
 */
export function fakeSockets({ autoAck = false, autoOpen = false } = {}) {
  const sockets: FakeSocket[] = [];
  return {
    sockets,
    last: () => sockets.at(-1)!,
    createSocket: (url: string) => {
      const socket = new FakeSocket(url, autoAck);
      sockets.push(socket);
      // 実物の WebSocket と同じく、作った後に非同期で開く
      if (autoOpen) queueMicrotask(() => socket.open());
      return socket;
    },
  };
}
