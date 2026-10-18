import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { NoWorkspaces } from "./no-workspaces";

describe("NoWorkspaces", () => {
  it("offers creating a workspace and points to invite links", async () => {
    const onCreate = vi.fn();
    render(<NoWorkspaces onCreate={onCreate} />);

    expect(screen.getByRole("heading", { name: "まだワークスペースがありません" })).toBeInTheDocument();
    expect(screen.getByText(/届いた招待リンクを開くと参加できます/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "ワークスペースを作成" }));
    expect(onCreate).toHaveBeenCalledOnce();
  });

  it("lets the user switch accounts", async () => {
    const onLogout = vi.fn();
    render(<NoWorkspaces onLogout={onLogout} />);

    await userEvent.click(screen.getByRole("button", { name: "ログアウト" }));
    expect(onLogout).toHaveBeenCalledOnce();
  });
});
