import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { type DmCandidateView, StartDmDialog } from "./start-dm";

describe("StartDmDialog", () => {
  const candidates: DmCandidateView[] = [
    { id: "u2", name: "佐藤 直樹", handle: "naoki", presence: "online" },
    { id: "u3", name: "中村 涼", handle: "nakamura", presence: "offline" },
  ];

  it("needs a peer before opening", async () => {
    const onSelect = vi.fn();
    const { rerender } = render(<StartDmDialog open candidates={candidates} onSelect={onSelect} />);

    expect(screen.getByRole("button", { name: "開く" })).toBeDisabled();
    await userEvent.click(screen.getByRole("radio", { name: /佐藤 直樹/ }));
    expect(onSelect).toHaveBeenCalledWith("u2");

    rerender(<StartDmDialog open candidates={candidates} selectedId="u2" />);
    expect(screen.getByRole("button", { name: "開く" })).toBeEnabled();
  });

  it("offers a single peer only (no group DMs)", () => {
    render(<StartDmDialog open candidates={candidates} />);

    expect(screen.getAllByRole("radio")).toHaveLength(2);
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });
});
