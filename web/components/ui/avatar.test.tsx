import { render, screen } from "@testing-library/react";
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
