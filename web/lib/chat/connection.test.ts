import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/error";
import type { ServerEvent } from "@/lib/api/types.gen";
import { fakeSockets } from "@/test/fake-socket";

import { type ConnectionOptions, type ConnectionState, createConnection, webSocketUrl } from "./connection";

function setup(overrides: Partial<ConnectionOptions> = {}) {
  const sockets = fakeSockets();
  let n = 0;
  const network = { online: () => {}, offline: () => {} };
  const states: ConnectionState[] = [];
  const events: ServerEvent[] = [];
  const onOpen = vi.fn();
  const options: ConnectionOptions = {
    url: "ws://api.test/api/v1/ws",
    issueTicket: vi.fn(async () => `ticket-${++n}`),
    revalidateSession: vi.fn(async () => true),
    createSocket: sockets.createSocket,
    onOpen,
    onEvent: (e) => events.push(e),
    onStateChange: (s) => states.push(s),
    now: () => Date.now(),
    // ジッターの上限いっぱいを待つ（テストで待ち時間を決め打ちにする）
    random: () => 1,
    isOnline: () => true,
    watchNetwork: (handlers) => {
      Object.assign(network, handlers);
      return () => Object.assign(network, { online: () => {}, offline: () => {} });
    },
    ...overrides,
  };
  const connection = createConnection(options);
  return { connection, sockets, options, states, events, onOpen, network, status: () => connection.getState().status };
}

describe("createConnection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("connects with a fresh ws-ticket in the query", async () => {
    const { connection, sockets, onOpen, status } = setup();

    connection.start();
    expect(status()).toBe("connecting");
    await vi.advanceTimersByTimeAsync(0);
    expect(sockets.last().url).toBe("ws://api.test/api/v1/ws?ticket=ticket-1");

    sockets.last().open();
    expect(status()).toBe("open");
    expect(onOpen).toHaveBeenCalledTimes(1);
    connection.stop();
  });

  it("resolves a request with the ack of the same id", async () => {
    const { connection, sockets } = setup();
    connection.start();
    await vi.advanceTimersByTimeAsync(0);
    sockets.last().open();

    const ack = connection.request({ type: "subscribe", room_id: "r1" });
    const sent = sockets.last().sent[0];
    expect(sent).toEqual({ type: "subscribe", room_id: "r1", id: expect.any(String) });
    sockets.last().receive({ type: "ack", id: sent.id!, error: "not_found" });

    await expect(ack).resolves.toEqual({ type: "ack", id: sent.id, error: "not_found" });
    connection.stop();
  });

  it("passes events through and fails pending requests when the connection drops", async () => {
    const { connection, sockets, events } = setup();
    connection.start();
    await vi.advanceTimersByTimeAsync(0);
    sockets.last().open();

    const event: ServerEvent = { type: "presence.changed", data: { user_id: "u1", online: true } };
    sockets.last().receive(event);
    const ack = connection.request({ type: "subscribe", room_id: "r1" });
    sockets.last().serverClose(1001);

    expect(events).toEqual([event]);
    await expect(ack).rejects.toThrow("websocket connection closed");
    connection.stop();
  });

  it("reconnects with exponential backoff and a new ticket each time", async () => {
    const { connection, sockets, status, options } = setup();
    connection.start();
    await vi.advanceTimersByTimeAsync(0);

    // 開く前に切れる（ticket が使えなかったときも、ブラウザにはこう見える）
    sockets.last().serverClose(1006);
    expect(status()).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(999);
    expect(sockets.sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets.sockets).toHaveLength(2);
    expect(sockets.last().url).toContain("ticket-2");

    sockets.last().serverClose(1006);
    await vi.advanceTimersByTimeAsync(1999);
    expect(sockets.sockets).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets.sockets).toHaveLength(3);
    expect(options.issueTicket).toHaveBeenCalledTimes(3);
    connection.stop();
  });

  it("caps the backoff and spreads it with jitter", async () => {
    const { connection, sockets } = setup({ random: () => 0.5 });
    connection.start();
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 10; i++) {
      sockets.last().serverClose(1006);
      await vi.advanceTimersByTimeAsync(15_000);
    }
    // 上限 30 秒 × 0.5 = 15 秒ごとに試している
    expect(sockets.sockets).toHaveLength(11);
    connection.stop();
  });

  it("resets the backoff after a connection that stayed up", async () => {
    const { connection, sockets } = setup();
    connection.start();
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 3; i++) {
      sockets.last().serverClose(1006);
      await vi.advanceTimersByTimeAsync(2 ** i * 1000);
    }
    sockets.last().open();
    // ping に答え続けて 1 分つながっていた
    const socket = sockets.last();
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(25_000);
      socket.receive({ type: "ack", id: socket.sent.at(-1)!.id! });
    }

    socket.serverClose(1001);
    await vi.advanceTimersByTimeAsync(1000);
    expect(sockets.sockets).toHaveLength(5);
    connection.stop();
  });

  it("closes a connection whose ping is not acknowledged and reconnects", async () => {
    const { connection, sockets, status } = setup();
    connection.start();
    await vi.advanceTimersByTimeAsync(0);
    sockets.last().open();
    const socket = sockets.last();

    await vi.advanceTimersByTimeAsync(25_000);
    expect(socket.sent).toEqual([{ type: "ping", id: expect.any(String) }]);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(socket.closed).toBe(true);
    expect(status()).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(1000);
    expect(sockets.sockets).toHaveLength(2);
    connection.stop();
  });

  it("treats going offline as a disconnect and reconnects at once when back online", async () => {
    const { connection, sockets, status, network } = setup();
    connection.start();
    await vi.advanceTimersByTimeAsync(0);
    sockets.last().open();

    network.offline();
    expect(sockets.last().closed).toBe(true);
    expect(status()).toBe("reconnecting");

    network.online();
    await vi.advanceTimersByTimeAsync(0);
    expect(sockets.sockets).toHaveLength(2);
    connection.stop();
  });

  describe("session revoked (4001)", () => {
    it("revalidates the session and reconnects when it is still valid", async () => {
      const { connection, sockets, options } = setup();
      connection.start();
      await vi.advanceTimersByTimeAsync(0);
      sockets.last().open();

      sockets.last().serverClose(4001);
      await vi.advanceTimersByTimeAsync(1000);

      expect(options.revalidateSession).toHaveBeenCalledTimes(1);
      expect(sockets.sockets).toHaveLength(2);
      connection.stop();
    });

    it("stops for good when the session is gone", async () => {
      const { connection, sockets, status } = setup({ revalidateSession: async () => false });
      connection.start();
      await vi.advanceTimersByTimeAsync(0);
      sockets.last().open();

      sockets.last().serverClose(4001);
      await vi.advanceTimersByTimeAsync(60_000);

      expect(status()).toBe("closed");
      expect(sockets.sockets).toHaveLength(1);
    });
  });

  it("stops when issuing the ticket is unauthorized", async () => {
    const { connection, status, sockets } = setup({
      issueTicket: async () => {
        throw new ApiError(401, undefined);
      },
    });

    connection.start();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(status()).toBe("closed");
    expect(sockets.sockets).toHaveLength(0);
  });

  it("counts attempts that could not reach the server, but not while offline or on other errors", async () => {
    let online = true;
    let failure: Error = new TypeError("fetch failed");
    const { connection, sockets } = setup({
      isOnline: () => online,
      issueTicket: async () => {
        if (failure) throw failure;
        return "t";
      },
    });

    connection.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(connection.getState().unreachableAttempts).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(connection.getState().unreachableAttempts).toBe(2);

    failure = new ApiError(503, undefined);
    await vi.advanceTimersByTimeAsync(2000);
    expect(connection.getState().unreachableAttempts).toBe(3);

    failure = new ApiError(500, undefined);
    await vi.advanceTimersByTimeAsync(4000);
    online = false;
    failure = new TypeError("fetch failed");
    await vi.advanceTimersByTimeAsync(8000);
    expect(connection.getState().unreachableAttempts).toBe(3);

    failure = undefined as unknown as Error;
    await vi.advanceTimersByTimeAsync(16_000);
    sockets.last().open();
    expect(connection.getState()).toMatchObject({ status: "open", unreachableAttempts: 0, lastOpenedAt: Date.now() });
    connection.stop();
  });

  it("retries immediately on request instead of waiting for the backoff", async () => {
    const { connection, sockets } = setup();
    connection.start();
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 5; i++) {
      sockets.last().serverClose(1006);
      await vi.advanceTimersByTimeAsync(2 ** i * 1000);
    }
    sockets.last().serverClose(1006);

    connection.retryNow();
    await vi.advanceTimersByTimeAsync(0);

    expect(sockets.sockets).toHaveLength(7);
    connection.stop();
  });

  it("leaves no timers or sockets behind after stop", async () => {
    const { connection, sockets, network } = setup();
    connection.start();
    await vi.advanceTimersByTimeAsync(0);
    sockets.last().open();

    connection.stop();

    expect(sockets.last().closed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    network.online();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets.sockets).toHaveLength(1);
  });

  it("ignores a ticket that arrives after stop", async () => {
    let resolve!: (t: string) => void;
    const { connection, sockets } = setup({ issueTicket: () => new Promise((r) => (resolve = r)) });
    connection.start();

    connection.stop();
    resolve("late");
    await vi.advanceTimersByTimeAsync(0);

    expect(sockets.sockets).toHaveLength(0);
  });
});

describe("webSocketUrl", () => {
  it.each([
    ["http://localhost:8080", "ws://localhost:8080/api/v1/ws"],
    ["https://api.hibari.example", "wss://api.hibari.example/api/v1/ws"],
  ])("%s → %s", (base, url) => {
    expect(webSocketUrl(base)).toBe(url);
  });
});
