import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SearchPanel } from "./search-panel";

describe("SearchPanel（ADR 0061）", () => {
  it("何も打っていなければ、結果を出す候補は出さない", () => {
    render(<SearchPanel value="" workspaceName="hibari 開発" roomName="デザインレビュー" />);

    expect(screen.queryByText(/の検索結果を表示する/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /デザインレビュー で検索する/ })).toBeInTheDocument();
  });

  it("空白だけの入力は「打っていない」として扱う", () => {
    render(<SearchPanel value="   " workspaceName="hibari 開発" />);

    expect(screen.queryByText(/の検索結果を表示する/)).not.toBeInTheDocument();
  });

  it("打つと、結果を出す候補と Enter の案内を出す", () => {
    render(<SearchPanel value="面談" workspaceName="hibari 開発" roomName="デザインレビュー" />);

    expect(screen.getByRole("button", { name: /面談 の検索結果を表示する/ })).toBeInTheDocument();
    expect(screen.getByText("Enter")).toBeInTheDocument();
  });

  it("ルームを開いていなければ、そのルームで探す候補を出さない", () => {
    render(<SearchPanel value="面談" workspaceName="hibari 開発" />);

    expect(screen.queryByText(/で検索する/)).not.toBeInTheDocument();
  });

  it("Enter で onSubmit、Esc で onClose を呼ぶ", async () => {
    const onSubmit = vi.fn();
    const onClose = vi.fn();
    render(<SearchPanel value="面談" workspaceName="hibari 開発" onSubmit={onSubmit} onClose={onClose} />);

    const input = screen.getByRole("textbox", { name: "メッセージを検索" });
    await userEvent.type(input, "{Enter}");
    expect(onSubmit).toHaveBeenCalledTimes(1);
    await userEvent.type(input, "{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("打った文字を onChange で返す", async () => {
    const onChange = vi.fn();
    render(<SearchPanel value="" workspaceName="hibari 開発" onChange={onChange} />);

    await userEvent.type(screen.getByRole("textbox", { name: "メッセージを検索" }), "面");
    expect(onChange).toHaveBeenCalledWith("面");
  });

  it("チャンネルに絞る候補を押すと onSearchInRoom を呼ぶ", async () => {
    const onSearchInRoom = vi.fn();
    render(
      <SearchPanel value="面談" workspaceName="hibari 開発" roomName="デザインレビュー" onSearchInRoom={onSearchInRoom} />,
    );

    await userEvent.click(screen.getByRole("button", { name: /デザインレビュー で検索する/ }));
    expect(onSearchInRoom).toHaveBeenCalledTimes(1);
  });
});
