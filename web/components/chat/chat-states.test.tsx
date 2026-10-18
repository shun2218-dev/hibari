import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  ArchivedRoomBar,
  EmptyMessages,
  JoinRoomBar,
  MessageNotFoundNotice,
  RemovedFromWorkspace,
  RoomUnavailable,
  ServerUnavailable,
  UnreadJumpBar,
} from "./chat-states";

describe("chat states", () => {
  it.each([
    ["public", "# デザインレビュー のはじまりです"],
    ["private", "リリース準備 のはじまりです"],
  ] as const)("names a %s room with no messages", (kind, text) => {
    render(<EmptyMessages kind={kind} name={kind === "public" ? "デザインレビュー" : "リリース準備"} />);

    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it("says only that the room cannot be accessed, not that I was removed", () => {
    render(<RoomUnavailable />);

    expect(screen.getByRole("heading", { name: "このチャンネルにはアクセスできません" })).toBeInTheDocument();
    expect(screen.getByText("チャンネルが存在しないか、閲覧する権限がありません。")).toBeInTheDocument();
    expect(screen.queryByText(/外され/)).not.toBeInTheDocument();
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

  it("アーカイブしたルームでは、入力欄の代わりに読み取り専用だと伝え、復元できる人にだけボタンを出す（ADR 0059）", async () => {
    const onRestore = vi.fn();
    const { rerender } = render(<ArchivedRoomBar onRestore={onRestore} />);
    expect(screen.getByText("アーカイブされたチャンネルです。投稿やリアクションはできません。")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "チャンネルを復元" }));
    expect(onRestore).toHaveBeenCalledOnce();

    rerender(<ArchivedRoomBar />);
    expect(screen.queryByRole("button", { name: "チャンネルを復元" })).not.toBeInTheDocument();
  });

  it("未読の件数と、最初の未読へ飛ぶ操作を出す（ADR 0042）", async () => {
    const onJump = vi.fn();
    render(<UnreadJumpBar count={12} onJump={onJump} />);

    expect(screen.getByText("未読 12 件")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "最初の未読へ" }));
    expect(onJump).toHaveBeenCalledOnce();
  });

  it("見つからなかったメッセージは、理由を言わずに 1 行だけ知らせて閉じられる（ADR 0040 / 0042）", async () => {
    const onClose = vi.fn();
    render(<MessageNotFoundNotice onClose={onClose} />);

    expect(screen.getByText("そのメッセージは見つかりませんでした")).toBeInTheDocument();
    // ない・読めない・削除済みを区別しない
    expect(screen.queryByText(/削除|権限/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "知らせを閉じる" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows when the server was last reached", () => {
    render(<ServerUnavailable lastConnectedLabel="11:07" retryCount={3} />);

    expect(screen.getByText("最終接続 11:07 · 再試行 3回")).toBeInTheDocument();
  });
});
