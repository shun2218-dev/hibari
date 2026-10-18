import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { HoverActions } from "./hover-actions";

const all = {
  canReact: true,
  pickerOpen: false,
  canReply: true,
  save: { saved: false, onClick: () => {} },
  hasMenu: true,
  menuOpen: false,
};

describe("HoverActions の名前の吹き出し", () => {
  it("どのボタンにも、何の操作かの名前を添える", () => {
    render(<HoverActions {...all} />);

    for (const name of ["リアクションを追加", "スレッドで返信する", "「後で」に保存", "その他の操作"]) {
      expect(screen.getByRole("button", { name, hidden: true })).toBeInTheDocument();
      expect(screen.getByText(name)).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("保存済みなら、外す操作の名前にする", () => {
    render(<HoverActions {...all} save={{ saved: true, onClick: () => {} }} />);

    expect(screen.getByText("「後で」から外す")).toBeInTheDocument();
  });

  it("ピッカーやメニューを開いている間は、そのボタンの名前を出さない", () => {
    render(<HoverActions {...all} pickerOpen menuOpen />);

    expect(screen.queryByText("リアクションを追加")).not.toBeInTheDocument();
    expect(screen.queryByText("その他の操作")).not.toBeInTheDocument();
    expect(screen.getByText("スレッドで返信する")).toBeInTheDocument();
  });
});

describe("HoverActions の吹き出しの向き", () => {
  it("いちばん右のボタンだけ、吹き出しの右端をそろえる（切れないように）", () => {
    const { rerender } = render(<HoverActions {...all} />);
    expect(screen.getByText("その他の操作")).toHaveClass("right-0");
    expect(screen.getByText("スレッドで返信する")).not.toHaveClass("right-0");

    // 「…」も保存もないときは、返信が右端になる
    rerender(<HoverActions {...all} save={undefined} hasMenu={false} />);
    expect(screen.getByText("スレッドで返信する")).toHaveClass("right-0");
  });
});
