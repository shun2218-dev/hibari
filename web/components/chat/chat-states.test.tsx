import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EmptyMessages, JoinRoomBar, RemovedFromRoom, RemovedFromWorkspace, ServerUnavailable } from "./chat-states";

describe("chat states", () => {
  it.each([
    ["public", "# デザインレビュー のはじまりです"],
    ["private", "リリース準備 のはじまりです"],
  ] as const)("names a %s room with no messages", (kind, text) => {
    render(<EmptyMessages kind={kind} name={kind === "public" ? "デザインレビュー" : "リリース準備"} />);

    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it("explains removal from a room", () => {
    render(<RemovedFromRoom kind="public" name="デザインレビュー" />);

    expect(screen.getByRole("heading", { name: "このチャンネルから外されました" })).toBeInTheDocument();
    expect(screen.getByText(/「# デザインレビュー」のメンバーではなくなった/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "チャンネル一覧に戻る" })).toBeInTheDocument();
  });

  it("explains removal from a workspace", () => {
    render(<RemovedFromWorkspace workspaceName="hibari 開発" />);

    expect(screen.getByRole("heading", { name: "ワークスペースから削除されました" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "別のワークスペースに移動" })).toBeInTheDocument();
  });

  it("asks to join before posting", () => {
    const { rerender } = render(<JoinRoomBar />);
    expect(screen.getByText("このチャンネルに参加すると投稿できます")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "参加する" })).toBeEnabled();

    rerender(<JoinRoomBar joining />);
    expect(screen.getByRole("button", { name: "参加する" })).toBeDisabled();
  });

  it("shows when the server was last reached", () => {
    render(<ServerUnavailable lastConnectedLabel="11:07" retryCount={3} />);

    expect(screen.getByText("最終接続 11:07 · 再試行 3回")).toBeInTheDocument();
  });
});
