import { describe, expect, it } from "vitest";

import { savedItem } from "@/test/chat-data";

import { type SavedTabState, applySavedItem } from "./saved";

const ready = (items: ReturnType<typeof savedItem>[], hasMore = false): SavedTabState => ({
  status: "ready",
  items,
  hasMore,
  loadingMore: false,
});

describe("applySavedItem", () => {
  it("moves an item from its old tab to the tab of its new state, keeping the newest-saved order", () => {
    const tabs = { in_progress: ready([savedItem(3), savedItem(1)]), archived: ready([savedItem(2, { state: "archived" })]) };

    const next = applySavedItem(tabs, savedItem(3, { state: "archived", change_seq: 9 }));

    expect(next.in_progress?.items.map((i) => i.message_id)).toEqual(["m-1"]);
    expect(next.archived?.items.map((i) => i.message_id)).toEqual(["m-3", "m-2"]);
  });

  it("drops a removed item from every tab and leaves tabs it has not loaded alone", () => {
    const tabs = { in_progress: ready([savedItem(1)]) };

    const next = applySavedItem(tabs, savedItem(1, { state: "removed", change_seq: 5, status: "unavailable", room: null, message: null }));

    expect(next.in_progress?.items).toEqual([]);
    expect(next.archived).toBeUndefined();
  });

  it("does not insert an item older than the loaded window when the tab has more", () => {
    const tabs = { in_progress: ready([savedItem(5), savedItem(4)], true) };

    expect(applySavedItem(tabs, savedItem(2)).in_progress?.items.map((i) => i.message_id)).toEqual(["m-5", "m-4"]);
    expect(applySavedItem(tabs, savedItem(6)).in_progress?.items.map((i) => i.message_id)).toEqual(["m-6", "m-5", "m-4"]);
  });

  it("ignores an older copy of an item, and returns the same object when nothing changes", () => {
    const tabs = { in_progress: ready([savedItem(1, { change_seq: 7 })]) };

    expect(applySavedItem(tabs, savedItem(1, { state: "archived", change_seq: 6 }))).toBe(tabs);
    expect(applySavedItem({}, savedItem(1))).toEqual({});
  });
});
