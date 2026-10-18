import { beforeEach, describe, expect, it } from "vitest";

import { forgetLocation, lastRoomId, lastWorkspaceId, rememberLocation } from "./last-location";

describe("last location", () => {
  beforeEach(() => window.localStorage.clear());

  it("remembers the workspace and the last room per workspace", () => {
    rememberLocation("ws-1", "room-a");
    rememberLocation("ws-2", "room-b");
    rememberLocation("ws-1", undefined);

    expect(lastWorkspaceId()).toBe("ws-1");
    expect(lastRoomId("ws-1")).toBe("room-a");
    expect(lastRoomId("ws-2")).toBe("room-b");
  });

  it("forgets a room only if it is the remembered one", () => {
    rememberLocation("ws-1", "room-a");

    forgetLocation("ws-1", "room-other");
    expect(lastRoomId("ws-1")).toBe("room-a");

    forgetLocation("ws-1", "room-a");
    expect(lastRoomId("ws-1")).toBeUndefined();
    expect(lastWorkspaceId()).toBe("ws-1");
  });

  it("forgets a whole workspace", () => {
    rememberLocation("ws-1", "room-a");

    forgetLocation("ws-1");

    expect(lastWorkspaceId()).toBeUndefined();
    expect(lastRoomId("ws-1")).toBeUndefined();
  });

  it("treats a broken value as nothing remembered", () => {
    window.localStorage.setItem("hibari:last-location", "{not json");

    expect(lastWorkspaceId()).toBeUndefined();
    rememberLocation("ws-1", "room-a");
    expect(lastRoomId("ws-1")).toBe("room-a");
  });

  it("works without storage", () => {
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    } as unknown as Storage;

    expect(() => rememberLocation("ws-1", "room-a", broken)).not.toThrow();
    expect(lastWorkspaceId(broken)).toBeUndefined();
  });
});
