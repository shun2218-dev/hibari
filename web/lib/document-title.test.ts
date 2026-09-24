import { describe, expect, it } from "vitest";

import { activityPart, chatTitle, documentTitle, TITLE_TEMPLATE, titleParts } from "./document-title";

describe("documentTitle", () => {
  it("部分を ` - ` で並べ、最後にアプリ名を付ける", () => {
    expect(documentTitle("メンバー", "開発チーム")).toBe("メンバー - 開発チーム - hibari");
  });

  it("空の部分と undefined は飛ばす", () => {
    expect(documentTitle(undefined, "", "開発チーム")).toBe("開発チーム - hibari");
    expect(documentTitle()).toBe("hibari");
  });

  it("metadata の template と同じ形になる", () => {
    expect(TITLE_TEMPLATE.replace("%s", "ログイン")).toBe(documentTitle("ログイン"));
  });
});

describe("titleParts", () => {
  it("アプリ名を付けずに並べる（metadata の template が付ける）", () => {
    expect(titleParts("プロフィール", "設定")).toBe("プロフィール - 設定");
    expect(TITLE_TEMPLATE.replace("%s", titleParts("プロフィール", "設定"))).toBe(documentTitle("プロフィール", "設定"));
  });
});

describe("activityPart", () => {
  it.each([
    [1, "1 個の新しいアイテム"],
    [12, "12 個の新しいアイテム"],
  ])("%i 件なら「%s」", (count, want) => {
    expect(activityPart(count)).toBe(want);
  });

  it("0 件なら部分ごと省く", () => {
    expect(activityPart(0)).toBeUndefined();
  });
});

describe("chatTitle", () => {
  it.each([
    {
      name: "ルームとアクティビティ",
      input: { main: "general", workspaceName: "開発チーム", activity: 3 },
      want: "general - 開発チーム - 3 個の新しいアイテム - hibari",
    },
    {
      name: "アクティビティが 0 なら数を出さない",
      input: { main: "general", workspaceName: "開発チーム", activity: 0 },
      want: "general - 開発チーム - hibari",
    },
    {
      name: "DM は相手の表示名",
      input: { main: "佐藤 花子", workspaceName: "開発チーム", activity: 0 },
      want: "佐藤 花子 - 開発チーム - hibari",
    },
    {
      name: "スレッドの一覧",
      input: { main: "スレッド", workspaceName: "開発チーム", activity: 1 },
      want: "スレッド - 開発チーム - 1 個の新しいアイテム - hibari",
    },
    {
      name: "ルームがまだ読めていなければワークスペース名から",
      input: { workspaceName: "開発チーム", activity: 0 },
      want: "開発チーム - hibari",
    },
    {
      name: "何も読めていなければアプリ名だけ",
      input: { activity: 0 },
      want: "hibari",
    },
  ])("$name", ({ input, want }) => {
    expect(chatTitle(input)).toBe(want);
  });
});
