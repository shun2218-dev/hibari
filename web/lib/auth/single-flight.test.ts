import { describe, expect, it, vi } from "vitest";

import { type LockManagerLike, singleFlight } from "./single-flight";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Web Locks と同じく、同じ名前のロックを取った順に 1 つずつ実行する。 */
function fakeLocks(): LockManagerLike {
  const tails = new Map<string, Promise<unknown>>();
  return {
    request<T>(name: string, callback: () => Promise<T>) {
      const prev = tails.get(name) ?? Promise.resolve();
      const result = prev.then(callback, callback);
      tails.set(name, result.catch(() => undefined));
      return result;
    },
  };
}

describe("singleFlight", () => {
  it("shares one run between concurrent callers in the same tab", async () => {
    const gate = deferred();
    const run = vi.fn(() => gate.promise);
    const call = singleFlight("x", run, undefined);

    const calls = [call(), call(), call()];
    gate.resolve();
    await Promise.all(calls);

    expect(run).toHaveBeenCalledOnce();
  });

  it("runs again once the previous run has settled", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const call = singleFlight("x", run, undefined);

    await call();
    await call();

    expect(run).toHaveBeenCalledTimes(2);
  });

  it("lets the next caller retry after a failure", async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce("ok");
    const call = singleFlight("x", run, undefined);

    await expect(call()).rejects.toThrow("offline");
    await expect(call()).resolves.toBe("ok");
  });

  it("serializes runs across tabs that share the lock manager", async () => {
    // 2 つのタブ（別々の singleFlight）が同じ名前のロックを取る
    const locks = fakeLocks();
    const order: string[] = [];
    const firstGate = deferred();
    const tabA = singleFlight(
      "hibari:refresh",
      async () => {
        order.push("A start");
        await firstGate.promise;
        order.push("A end");
      },
      locks,
    );
    const tabB = singleFlight(
      "hibari:refresh",
      async () => {
        order.push("B start");
      },
      locks,
    );

    const a = tabA();
    const b = tabB();
    await Promise.resolve();
    firstGate.resolve();
    await Promise.all([a, b]);

    expect(order).toEqual(["A start", "A end", "B start"]);
  });
});
