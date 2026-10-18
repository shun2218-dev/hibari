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

  // ADR 0049: オンラインは緑、離席は色なしのアウトライン、オフラインはドットそのものを出さない
  it("shows a green dot when online", () => {
    render(<Avatar id="u1" name="あなた" presence="online" />);

    expect(screen.getByRole("img", { name: "オンライン" })).toHaveClass("bg-online");
  });

  it("shows an outlined dot when away", () => {
    render(<Avatar id="u1" name="あなた" presence="away" />);

    const dot = screen.getByRole("img", { name: "離席中" });
    expect(dot).toHaveClass("border-2");
    expect(dot).not.toHaveClass("bg-online");
  });

  it("shows no dot when offline", () => {
    render(<Avatar id="u1" name="あなた" presence="offline" />);

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
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

  it("tries the image again once a new url arrives", () => {
    const { rerender } = render(<Avatar id="u1" name="あなた" imageUrl="https://storage.test/expired.png" />);
    fireEvent.error(screen.getByRole("presentation", { hidden: true }));

    rerender(<Avatar id="u1" name="あなた" imageUrl="https://storage.test/renewed.png" />);

    expect(screen.getByRole("presentation", { hidden: true })).toHaveAttribute("src", "https://storage.test/renewed.png");
  });

  it("keeps presence next to the image", () => {
    render(<Avatar id="u1" name="あなた" imageUrl="https://storage.test/a.png" presence="online" />);

    expect(screen.getByRole("img", { name: "オンライン" })).toBeInTheDocument();
  });

  it("draws the profile photo as a rounded square that fills its box (ADR 0050)", () => {
    render(<Avatar id="u1" name="あなた" imageUrl="https://storage.test/a.png" size="photo" shape="square" />);

    const img = screen.getByRole("presentation", { hidden: true });
    expect(img).toHaveClass("aspect-square", "w-full", "rounded-lg");
    expect(img).not.toHaveClass("rounded-full");
  });
});
