import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  ConfirmMentionAllDialog,
  CreateRoomDialog,
  DeleteAttachmentDialog,
  DeleteMessageDialog,
  LeaveRoomDialog,
  RoomSettingsDialog,
  StartDmDialog,
} from "./room-dialogs";

describe("CreateRoomDialog", () => {
  it("says that the visibility cannot be changed later", () => {
    render(<CreateRoomDialog open name="" kind="public" />);

    expect(screen.getByRole("dialog", { name: "チャンネルを作成" })).toHaveAccessibleDescription(
      "あとから名前は変更できます。公開範囲は作成後に変えられません。",
    );
  });

  it("requires a name", async () => {
    const onCreate = vi.fn();
    const { rerender } = render(<CreateRoomDialog open name="   " kind="public" onCreate={onCreate} />);
    expect(screen.getByRole("button", { name: "作成する" })).toBeDisabled();

    rerender(<CreateRoomDialog open name="デザインレビュー" kind="public" onCreate={onCreate} />);
    await userEvent.click(screen.getByRole("button", { name: "作成する" }));
    expect(onCreate).toHaveBeenCalledOnce();
  });

  it("switches the visibility", async () => {
    const onKindChange = vi.fn();
    render(<CreateRoomDialog open name="雑談" kind="public" onKindChange={onKindChange} />);

    expect(screen.getByRole("radio", { name: /^公開/ })).toBeChecked();
    await userEvent.click(screen.getByRole("radio", { name: /非公開/ }));
    expect(onKindChange).toHaveBeenCalledWith("private");
  });
});

describe("StartDmDialog", () => {
  const candidates = [
    { id: "u2", name: "佐藤 直樹", handle: "naoki", online: true },
    { id: "u3", name: "中村 涼", handle: "nakamura", online: false },
  ];

  it("needs a peer before opening", async () => {
    const onSelect = vi.fn();
    const { rerender } = render(<StartDmDialog open candidates={candidates} onSelect={onSelect} />);

    expect(screen.getByRole("button", { name: "開く" })).toBeDisabled();
    await userEvent.click(screen.getByRole("radio", { name: /佐藤 直樹/ }));
    expect(onSelect).toHaveBeenCalledWith("u2");

    rerender(<StartDmDialog open candidates={candidates} selectedId="u2" />);
    expect(screen.getByRole("button", { name: "開く" })).toBeEnabled();
  });

  it("offers a single peer only (no group DMs)", () => {
    render(<StartDmDialog open candidates={candidates} />);

    expect(screen.getAllByRole("radio")).toHaveLength(2);
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });
});

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

describe("LeaveRoomDialog", () => {
  it.each([
    { kind: "public" as const, consequence: "退出したあとも読めます" },
    { kind: "private" as const, consequence: "退出すると読めなくなります" },
  ])("names the room and says whether it stays readable ($kind)", async ({ kind, consequence }) => {
    const onConfirm = vi.fn();
    render(<LeaveRoomDialog open kind={kind} name="リリース準備" onConfirm={onConfirm} />);

    expect(screen.getByText(new RegExp(`リリース準備 から退出します。.*${consequence}`))).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "退出する" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("cannot be confirmed twice while leaving", () => {
    render(<LeaveRoomDialog open kind="public" name="雑談" pending />);

    expect(screen.getByRole("button", { name: "退出する" })).toBeDisabled();
  });
});

describe("DeleteMessageDialog", () => {
  it("quotes the message being deleted", async () => {
    const onConfirm = vi.fn();
    render(<DeleteMessageDialog open body="了解です。今日の夕方までに一覧を更新して、また共有します。" onConfirm={onConfirm} />);

    expect(screen.getByText("了解です。今日の夕方までに一覧を更新して、また共有します。")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "削除する" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});

describe("DeleteAttachmentDialog（ADR 0045）", () => {
  it("ファイルだけを消すときは、メッセージが残ると伝える", async () => {
    const onConfirm = vi.fn();
    render(<DeleteAttachmentDialog open fileName="改訂 02.png" onConfirm={onConfirm} />);

    expect(screen.getByRole("dialog", { name: "ファイルを削除しますか？" })).toHaveAccessibleDescription(
      "このファイルだけを削除します。メッセージと本文は残ります。元には戻せません。",
    );
    expect(screen.getByText("改訂 02.png")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "削除する" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("最後の 1 枚で本文も空なら、メッセージごと消えることを先に伝える（ADR 0045 決定 8）", () => {
    render(<DeleteAttachmentDialog open alsoDeletesMessage fileName="未読バッジの候補.png" />);

    expect(screen.getByRole("dialog", { name: "メッセージごと削除しますか？" })).toHaveAccessibleDescription(
      "これがこのメッセージの最後の添付で、本文もありません。削除するとメッセージごと消えて、タイムラインからもなくなります。元には戻せません。",
    );
  });
});

describe("ConfirmMentionAllDialog", () => {
  it("@channel はメンバーの人数を出して、送信で確定する（ADR 0043）", async () => {
    const onConfirm = vi.fn();
    render(<ConfirmMentionAllDialog open kind="channel" memberCount={12} onConfirm={onConfirm} />);

    expect(screen.getByRole("dialog", { name: "@channel を送りますか？" })).toBeInTheDocument();
    expect(screen.getByText("このチャンネルのメンバー 12 人に知らせが飛びます。")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "送信する" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("@here はオンラインの人数を出して、キャンセルで閉じる", async () => {
    const onCancel = vi.fn();
    render(<ConfirmMentionAllDialog open kind="here" memberCount={4} onCancel={onCancel} />);

    expect(screen.getByText("いまオンラインの 4 人に知らせが飛びます。")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("閉じているときは何も出さない", () => {
    render(<ConfirmMentionAllDialog open={false} kind="channel" memberCount={12} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
