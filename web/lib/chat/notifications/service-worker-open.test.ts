import { describe, expect, it, vi } from "vitest";

import { listenServiceWorkerOpen } from "./service-worker-open";

function fakeContainer() {
  let listener: ((event: { data: unknown; ports: { postMessage: (m: unknown) => void }[] }) => void) | undefined;
  return {
    addEventListener: vi.fn((_type: "message", l: typeof listener) => {
      listener = l;
    }),
    removeEventListener: vi.fn(() => {
      listener = undefined;
    }),
    startMessages: vi.fn(),
    send(data: unknown) {
      const port = { postMessage: vi.fn() };
      listener?.({ data, ports: [port] });
      return port;
    },
  };
}

describe("listenServiceWorkerOpen", () => {
  it("開いて、ポートで応える", () => {
    const container = fakeContainer();
    const open = vi.fn();
    listenServiceWorkerOpen(container, open);
    expect(container.startMessages).toHaveBeenCalled();

    const port = container.send({ type: "hibari:open", url: "/w/ws1/r/r1?m=m1" });

    expect(open).toHaveBeenCalledWith("/w/ws1/r/r1?m=m1");
    expect(port.postMessage).toHaveBeenCalledWith("ok");
  });

  it.each([
    ["ほかの知らせ", { type: "other", url: "/w" }],
    ["サイトの外", { type: "hibari:open", url: "https://evil.example/" }],
    ["// で始まる", { type: "hibari:open", url: "//evil.example/" }],
    ["URL がない", { type: "hibari:open" }],
  ])("%s は開かず、応えない", (_name, data) => {
    const container = fakeContainer();
    const open = vi.fn();
    listenServiceWorkerOpen(container, open);
    const port = container.send(data);
    expect(open).not.toHaveBeenCalled();
    expect(port.postMessage).not.toHaveBeenCalled();
  });

  it("止めたら受けない。Service Worker のない環境では何もしない", () => {
    const container = fakeContainer();
    const open = vi.fn();
    listenServiceWorkerOpen(container, open)();
    container.send({ type: "hibari:open", url: "/" });
    expect(open).not.toHaveBeenCalled();
    expect(() => listenServiceWorkerOpen(undefined, open)()).not.toThrow();
  });
});
