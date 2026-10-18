import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { LinkDialog } from "./link-dialog";

describe("LinkDialog（ADR 0052 決定 5 / ADR 0051 決定 4 の追記）", () => {
  it("選んでいた文字を入れた状態で開き、URL を入れると保存できる", async () => {
    const onSave = vi.fn();
    render(<LinkDialog open initialText="手順書" onSave={onSave} />);

    expect(screen.getByLabelText("テキスト")).toHaveValue("手順書");
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();

    await userEvent.type(screen.getByLabelText("リンク"), "https://example.com/docs");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(onSave).toHaveBeenCalledWith({ text: "手順書", url: "https://example.com/docs" });
  });

  it("テキストが空なら URL をそのまま出す", async () => {
    const onSave = vi.fn();
    render(<LinkDialog open onSave={onSave} />);

    await userEvent.type(screen.getByLabelText("リンク"), "https://example.com");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(onSave).toHaveBeenCalledWith({ text: "https://example.com", url: "https://example.com" });
  });

  it("http / https でない URL は保存できない", async () => {
    render(<LinkDialog open />);

    await userEvent.type(screen.getByLabelText("リンク"), "javascript:alert(1)");

    expect(screen.getByText("http:// か https:// で始まる URL を入れてください")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
  });

  it("テキストに < > ` があると保存できない（本文で文字付きのリンクにならないため）", async () => {
    render(<LinkDialog open initialText="a <b>" initialUrl="https://example.com" />);

    expect(screen.getByText("< > ` は使えません")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
  });
});
