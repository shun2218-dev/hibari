import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { avatarColor } from "@/lib/avatar";

import { Avatar } from "./avatar";

describe("Avatar", () => {
  it("shows the initial on the color derived from the ID", () => {
    const { container } = render(<Avatar id="01J8ZH5K000000000000000002" name="佐藤 直樹" />);

    const face = container.querySelector("[aria-hidden]")!;
    expect(face).toHaveTextContent("佐");
    expect(face).toHaveClass(`bg-avatar-${avatarColor("01J8ZH5K000000000000000002")}`);
  });

  it("shows presence only when online", () => {
    const { rerender } = render(<Avatar id="u1" name="あなた" online />);
    expect(screen.getByRole("img", { name: "オンライン" })).toBeInTheDocument();

    rerender(<Avatar id="u1" name="あなた" online={false} />);
    expect(screen.queryByRole("img", { name: "オンライン" })).not.toBeInTheDocument();
  });
});

describe("Avatar with an image", () => {
  it("shows the image instead of the initial", () => {
    render(<Avatar id="u1" name="あなた" imageUrl="https://storage.test/a.png" />);

    expect(screen.getByRole("presentation", { hidden: true })).toHaveAttribute("src", "https://storage.test/a.png");
    expect(screen.queryByText("あ")).not.toBeInTheDocument();
  });

  it("falls back to the initial when the image cannot be loaded", () => {
    // 署名付き URL は期限切れになりうる。失敗しても画面が崩れないよう、頭文字に戻す（ADR 0020）。
    render(<Avatar id="u1" name="あなた" imageUrl="https://storage.test/expired.png" />);

    fireEvent.error(screen.getByRole("presentation", { hidden: true }));

    expect(screen.getByText("あ")).toBeInTheDocument();
  });

  it("keeps presence next to the image", () => {
    render(<Avatar id="u1" name="あなた" imageUrl="https://storage.test/a.png" online />);

    expect(screen.getByRole("img", { name: "オンライン" })).toBeInTheDocument();
  });
});
