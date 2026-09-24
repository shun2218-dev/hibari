import { describe, expect, it } from "vitest";

import type { Room } from "@/lib/api/types.gen";

import {
  type ChannelRef,
  channelLabel,
  channelTable,
  filterChannels,
  matchTypedChannel,
} from "./channel-links";

const ref = (id: string, name: string, over: Partial<ChannelRef> = {}): ChannelRef => ({
  id,
  name,
  private: false,
  archived: false,
  ...over,
});

describe("channelTable（ADR 0062 決定 2）", () => {
  const room = (over: Partial<Room>): Room => ({ kind: "public", name: "", archived_at: null, ...over }) as Room;

  it("public と private を入れ、DM は入れない。アーカイブ済みは印を付けて入れる", () => {
    const table = channelTable([
      room({ id: "r1", kind: "public", name: "雑談" }),
      room({ id: "r2", kind: "private", name: "リリース準備" }),
      room({ id: "r3", kind: "dm", name: null }),
      room({ id: "r4", kind: "public", name: "旧プロジェクト", archived_at: "2026-09-01T00:00:00Z" }),
    ]);

    expect(table).toEqual({
      r1: ref("r1", "雑談"),
      r2: ref("r2", "リリース準備", { private: true }),
      r4: ref("r4", "旧プロジェクト", { archived: true }),
    });
  });
});

describe("filterChannels（ADR 0062 決定 4）", () => {
  const table = {
    a: ref("a", "デザインレビュー"),
    b: ref("b", "雑談"),
    c: ref("c", "design-system", { private: true }),
    d: ref("d", "デザイン"),
    e: ref("e", "デザイン旧", { archived: true }),
    f: ref("f", "社内デザイン"),
  };

  it("前方一致を先、部分一致を後に、それぞれ名前の順で並べる。アーカイブ済みは出さない", () => {
    expect(filterChannels(table, "デザイン").map((c) => c.name)).toEqual(["デザイン", "デザインレビュー", "社内デザイン"]);
  });

  it("大文字小文字を区別しない", () => {
    expect(filterChannels(table, "DES").map((c) => c.name)).toEqual(["design-system"]);
  });

  it("空の問い合わせでは全部を名前の順で出し、上限で切る", () => {
    expect(filterChannels(table, "", 3).map((c) => c.name)).toEqual(["design-system", "デザイン", "デザインレビュー"]);
  });
});

describe("matchTypedChannel（ADR 0062 決定 4）", () => {
  const table = {
    a: ref("a", "デザイン"),
    b: ref("b", "デザインレビュー"),
    c: ref("c", "release notes"),
    d: ref("d", "General"),
  };

  it.each<[string, string, string | null]>([
    ["名前の後ろが文字の終わり", "デザインレビュー", "b"],
    ["いちばん長い一致を選ぶ", "デザインレビュー の件", "b"],
    ["空白で区切れば短い方", "デザイン レビュー", "a"],
    ["句読点も区切り", "デザイン、見て", "a"],
    ["空白を含む名前", "release notes を見て", "c"],
    ["大文字小文字を区別しない", "general です", "d"],
    ["名前の途中で終わるものは一致しない", "デザ", null],
    ["後ろに文字が続くものは一致しない", "デザインの件", null],
  ])("%s", (_name, text, want) => {
    expect(matchTypedChannel(table, text)?.channel.id ?? null).toBe(want);
  });

  it("一致した名前の長さを返す", () => {
    expect(matchTypedChannel(table, "release notes を見て")?.length).toBe("release notes".length);
  });
});

describe("channelLabel（ADR 0062 決定 3・5）", () => {
  it("引けたら #名前、引けなければ「アクセスできないチャンネル」", () => {
    expect(channelLabel({ a: ref("a", "雑談") }, "a")).toBe("#雑談");
    expect(channelLabel({}, "a")).toBe("#アクセスできないチャンネル");
  });
});
