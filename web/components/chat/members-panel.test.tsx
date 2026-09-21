import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MembersPanel } from "./members-panel";
import type { RoomMemberView } from "./types";

const members: RoomMemberView[] = [
  { id: "u1", name: "佐藤 直樹", presence: "online", roleLabel: "オーナー" },
  { id: "u2", name: "高橋 みゆき", presence: "away", roleLabel: "管理者", status: { emoji: "🎧", text: "集中しています" } },
  { id: "u3", name: "中村 涼", presence: "offline", roleLabel: "メンバー" },
];

describe("MembersPanel", () => {
  it("3 つの presence をドットで描き分ける（ADR 0049）", () => {
    render(<MembersPanel members={members} />);

    const rows = screen.getAllByRole("listitem");
    expect(within(rows[0]).getByRole("img", { name: "オンライン" })).toBeInTheDocument();
    expect(within(rows[1]).getByRole("img", { name: "離席中" })).toBeInTheDocument();
    // オフラインはドットを出さない（最終オンライン時刻も出さない）
    expect(within(rows[2]).queryByRole("img", { name: /オンライン|離席中/ })).not.toBeInTheDocument();
  });

  it("カスタムステータスは、絵文字を名前の横に、文言をロールの横に出す", () => {
    render(<MembersPanel members={members} />);

    const row = screen.getAllByRole("listitem")[1];
    expect(within(row).getByRole("img", { name: "ステータス: 🎧 集中しています" })).toBeInTheDocument();
    expect(within(row).getByText("管理者 · 集中しています")).toBeInTheDocument();
  });
});
