import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TopBar } from "./top-bar";

describe("TopBar（ADR 0061）", () => {
  it("検索していないときは、ワークスペースの名前を入れた文言を出す", () => {
    render(<TopBar workspaceName="hibari 開発" />);

    expect(screen.getByRole("button", { name: "hibari 開発 内を検索する" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "検索をやめる" })).not.toBeInTheDocument();
  });

  it("検索中は語を出し、× で検索をやめられる", async () => {
    const onClearQuery = vi.fn();
    render(<TopBar workspaceName="hibari 開発" query="面談" onClearQuery={onClearQuery} />);

    expect(screen.getByRole("button", { name: "検索：面談" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "検索をやめる" }));
    expect(onClearQuery).toHaveBeenCalledTimes(1);
  });

  it("検索欄を押すと onOpenSearch を呼ぶ", async () => {
    const onOpenSearch = vi.fn();
    render(<TopBar workspaceName="hibari 開発" onOpenSearch={onOpenSearch} />);

    await userEvent.click(screen.getByRole("button", { name: "hibari 開発 内を検索する" }));
    expect(onOpenSearch).toHaveBeenCalledTimes(1);
  });

  it("パネルを渡すと、検索欄の代わりにそれを描く", () => {
    render(<TopBar workspaceName="hibari 開発" panel={<div>パネル</div>} />);

    expect(screen.getByText("パネル")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /内を検索する/ })).not.toBeInTheDocument();
  });

  it("戻る・進むは、行き先がないときは押せない", async () => {
    const onBack = vi.fn();
    render(<TopBar workspaceName="hibari 開発" onBack={onBack} canGoBack />);

    expect(screen.getByRole("button", { name: "進む" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "戻る" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
