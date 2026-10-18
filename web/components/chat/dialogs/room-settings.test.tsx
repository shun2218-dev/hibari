import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RoomSettingsDialog } from "./room-settings";

describe("RoomSettingsDialog", () => {
  const members = [
    { id: "u2", name: "佐藤 直樹", isSelf: false, canRemove: true },
    { id: "u1", name: "あなた", isSelf: true, canRemove: false },
  ];

  it("edits the name and members of a private room", async () => {
    const onRemoveMember = vi.fn();
    render(<RoomSettingsDialog open kind="private" name="リリース準備" members={members} canEdit onRemoveMember={onRemoveMember} />);

    expect(screen.getByLabelText("チャンネル名")).toHaveValue("リリース準備");
    expect(screen.getByRole("button", { name: "メンバーを追加" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "外す" }));
    expect(onRemoveMember).toHaveBeenCalledWith("u2");
    // 自分の行には「外す」を出さない（退出は別の操作）
    const self = screen.getByText("あなた", { selector: "span.truncate" }).closest("li")!;
    expect(within(self).queryByRole("button", { name: "外す" })).not.toBeInTheDocument();
  });

  it("hides the member list for a public room (joining is free)", () => {
    render(<RoomSettingsDialog open kind="public" name="雑談" members={members} canEdit />);

    expect(screen.queryByText("参加しているメンバー")).not.toBeInTheDocument();
  });

  it("is read-only without permission", () => {
    render(<RoomSettingsDialog open kind="private" name="リリース準備" members={members} canEdit={false} />);

    expect(screen.getByLabelText("チャンネル名")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "保存する" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "メンバーを追加" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "外す" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "閉じる" })).toBeInTheDocument();
  });

  it("offers leaving to anyone who has joined, even without permission to edit", async () => {
    const onLeave = vi.fn();
    render(<RoomSettingsDialog open kind="private" name="リリース準備" members={members} canEdit={false} onLeave={onLeave} />);

    expect(screen.getByText(/退出すると読めなくなります/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "退出する" }));
    expect(onLeave).toHaveBeenCalledOnce();
  });

  it("does not offer leaving when onLeave is not given (a public room I have not joined)", () => {
    render(<RoomSettingsDialog open kind="public" name="雑談" members={[]} canEdit />);

    expect(screen.queryByRole("button", { name: "退出する" })).not.toBeInTheDocument();
  });
});

describe("RoomSettingsDialog のアーカイブと削除（ADR 0059）", () => {
  const members = [{ id: "u1", name: "あなた", isSelf: true, canRemove: false }];

  it("渡された操作の節だけを出す", async () => {
    const onArchive = vi.fn();
    const onDelete = vi.fn();
    const { rerender } = render(
      <RoomSettingsDialog open kind="public" name="雑談" members={members} canEdit={false} onArchive={onArchive} />,
    );
    expect(screen.queryByRole("heading", { name: "チャンネルを削除" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "アーカイブする" }));
    expect(onArchive).toHaveBeenCalledOnce();

    rerender(
      <RoomSettingsDialog open kind="public" name="雑談" members={members} canEdit onArchive={onArchive} onDelete={onDelete} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "削除する" }));
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it("アーカイブ中は、admin でも名前を変えられず、復元を出す", async () => {
    const onUnarchive = vi.fn();
    render(
      <RoomSettingsDialog open kind="private" name="リリース準備" members={members} canEdit archived onUnarchive={onUnarchive} onDelete={vi.fn()} />,
    );

    expect(screen.getByRole("textbox", { name: "チャンネル名" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "保存する" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "メンバーを追加" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "アーカイブする" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "復元する" }));
    expect(onUnarchive).toHaveBeenCalledOnce();
  });
});
