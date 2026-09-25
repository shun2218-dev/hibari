import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { RoomHeader } from "./room-header";

describe("RoomHeader の「通知」（ADR 0055）", () => {
  it("押すとメニューを開き、開いている間だけ中身を出す", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const { rerender } = render(
      <RoomHeader kind="public" name="雑談" memberCount={3} notifications={{ muted: false, open: false, onToggle, menu: <p>メニュー</p> }} />,
    );

    const button = screen.getByRole("button", { name: "通知" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("メニュー")).not.toBeInTheDocument();
    await user.click(button);
    expect(onToggle).toHaveBeenCalledOnce();

    rerender(
      <RoomHeader kind="public" name="雑談" memberCount={3} notifications={{ muted: false, open: true, onToggle, menu: <p>メニュー</p> }} />,
    );
    expect(screen.getByRole("button", { name: "通知" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("メニュー")).toBeInTheDocument();
  });

  it("ミュートしているときは、そう読めるボタンにする", () => {
    render(<RoomHeader kind="public" name="雑談" memberCount={3} notifications={{ muted: true, open: false }} />);

    expect(screen.getByRole("button", { name: "通知（ミュート中）" })).toBeInTheDocument();
  });

  it("設定を持てないとき（参加していない public ルーム）は出さない", () => {
    render(<RoomHeader kind="public" name="雑談" memberCount={3} />);

    expect(screen.queryByRole("button", { name: /通知/ })).not.toBeInTheDocument();
  });
});

describe("RoomHeader のアーカイブ（ADR 0059）", () => {
  it("アーカイブされていれば、名前の横にラベルを出す", () => {
    const { rerender } = render(<RoomHeader kind="public" name="雑談" memberCount={3} />);
    expect(screen.queryByText("アーカイブ済み")).not.toBeInTheDocument();

    rerender(<RoomHeader kind="public" name="雑談" memberCount={3} archived />);
    expect(screen.getByRole("heading")).toHaveTextContent("雑談アーカイブ済み");
  });
});

describe("RoomHeader のハドル（ADR 0066 決定 17）", () => {
  const naoki = { id: "u2", name: "佐藤 直樹" };

  it.each([
    [{ state: "idle" } as const, "ハドルミーティングを開始する"],
    [{ state: "active", participants: [naoki] } as const, "ハドルミーティングに参加する"],
    [{ state: "joined", participants: [naoki] } as const, "ハドルミーティングから退出する"],
  ])("%o のボタンは「%s」", async (state, label) => {
    const onClick = vi.fn();
    render(<RoomHeader kind="public" name="雑談" memberCount={3} huddle={{ ...state, onClick }} />);

    await userEvent.click(screen.getByRole("button", { name: label }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("入れない人（渡さないとき）には出さない", () => {
    render(<RoomHeader kind="public" name="雑談" memberCount={3} />);

    expect(screen.queryByRole("button", { name: /ハドル/ })).not.toBeInTheDocument();
  });
});
