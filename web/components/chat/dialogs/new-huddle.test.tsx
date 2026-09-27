import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { type NewHuddleCandidate, NewHuddleDialog, newHuddleValue } from "./new-huddle";

const naoki = { id: "u-naoki", name: "佐藤 直樹", handle: "naoki", presence: "online" } as const;
const candidates: NewHuddleCandidate[] = [
  { kind: "user", id: naoki.id, user: naoki },
  { kind: "room", id: "room-design", room: { kind: "public", name: "デザインレビュー" } },
];

describe("NewHuddleDialog（ADR 0067 決定 8）", () => {
  it("人とチャンネルを分けて並べ、選ぶと種類の付いた値を返す", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<NewHuddleDialog open candidates={candidates} onSelect={onSelect} />);

    expect(screen.getByRole("dialog", { name: "ハドルミーティングにメンバーを招待する" })).toBeInTheDocument();
    expect(screen.getByText("メンバー（DM）")).toBeInTheDocument();
    expect(screen.getByText("チャンネル")).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /デザインレビュー/ }));
    expect(onSelect).toHaveBeenCalledWith("room:room-design");
  });

  it("選ぶまで「ハドルミーティングを開始する」を押せない", async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    const { rerender } = render(<NewHuddleDialog open candidates={candidates} onStart={onStart} />);

    expect(screen.getByRole("button", { name: "ハドルミーティングを開始する" })).toBeDisabled();

    rerender(<NewHuddleDialog open candidates={candidates} selected={newHuddleValue(candidates[0])} onStart={onStart} />);
    expect(screen.getByRole("radio", { name: /佐藤 直樹/ })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "ハドルミーティングを開始する" }));
    expect(onStart).toHaveBeenCalledOnce();
  });

  it("DM を作っている間は、二重に押させない", () => {
    render(<NewHuddleDialog open candidates={candidates} selected="user:u-naoki" starting />);

    expect(screen.getByRole("button", { name: "ハドルミーティングを開始する" })).toBeDisabled();
  });

  it("一致する候補がなければ、そう書く", () => {
    render(<NewHuddleDialog open search="zzz" candidates={[]} />);

    expect(screen.getByText("一致する人やチャンネルがありません")).toBeInTheDocument();
  });
});
