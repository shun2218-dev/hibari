import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CreateInviteDialog, InviteCreatedDialog, InviteList } from "./invites";
import type { InviteRowView } from "./types";

const invites: InviteRowView[] = [
  { id: "i1", status: "active", createdByName: "田中 美咲", usesLabel: "3 / 10 回使用", expiryLabel: "9月20日 18:00 まで", canRevoke: true },
  { id: "i2", status: "exhausted", createdByName: "佐藤 直樹", usesLabel: "10 / 10 回使用", expiryLabel: "9月30日 09:00 まで", canRevoke: true },
  { id: "i3", status: "expired", createdByName: "田中 美咲", usesLabel: "1 / 無制限 回使用", expiryLabel: "9月1日 12:00 に失効", canRevoke: true },
  { id: "i4", status: "revoked", createdByName: "あなた", usesLabel: "2 / 5 回使用", expiryLabel: "9月18日 20:00 まで", canRevoke: true },
];

describe("InviteList", () => {
  it("labels each status and never shows the code", () => {
    render(<InviteList invites={invites} canCreate />);

    const rows = screen.getAllByRole("listitem");
    expect(rows.map((row) => within(row).getByText(/有効|上限到達|期限切れ|取り消し済み/).textContent)).toEqual([
      "有効",
      "上限到達",
      "期限切れ",
      "取り消し済み",
    ]);
    expect(screen.getAllByText("hibari.app/j/•••••••")).toHaveLength(4);
  });

  it("offers revoke only on active invites the viewer may revoke", async () => {
    const onRevoke = vi.fn();
    const { rerender } = render(<InviteList invites={invites} canCreate onRevoke={onRevoke} />);

    const buttons = screen.getAllByRole("button", { name: "取り消す" });
    expect(buttons).toHaveLength(1);
    await userEvent.click(buttons[0]);
    expect(onRevoke).toHaveBeenCalledWith("i1");

    rerender(<InviteList invites={invites.map((i) => ({ ...i, canRevoke: false }))} canCreate />);
    expect(screen.queryByRole("button", { name: "取り消す" })).not.toBeInTheDocument();
  });

  it("disables creating and says why when the viewer cannot create invites", () => {
    render(<InviteList invites={invites} canCreate={false} createLockedReason="管理者だけが招待リンクを作成できます。" />);

    expect(screen.getByRole("button", { name: "招待リンクを作成" })).toBeDisabled();
    expect(screen.getByText("管理者だけが招待リンクを作成できます。")).toBeInTheDocument();
  });
});

describe("CreateInviteDialog", () => {
  it("selects max uses and expiry", async () => {
    const onMaxUsesChange = vi.fn();
    const onExpiryChange = vi.fn();
    render(
      <CreateInviteDialog
        open
        maxUses={10}
        expiresInSeconds={604800}
        onMaxUsesChange={onMaxUsesChange}
        onExpiryChange={onExpiryChange}
      />,
    );

    expect(screen.getByRole("radio", { name: "10 回" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "7日" })).toBeChecked();

    await userEvent.click(screen.getByRole("radio", { name: "無制限" }));
    await userEvent.click(screen.getByRole("radio", { name: "30 分" }));
    expect(onMaxUsesChange).toHaveBeenCalledWith(null);
    expect(onExpiryChange).toHaveBeenCalledWith(1800);
  });
});

describe("InviteCreatedDialog", () => {
  it("shows the link once with a warning", async () => {
    const onCopy = vi.fn();
    render(<InviteCreatedDialog open url="https://hibari.app/j/7Qv2xkR8mA" summary="10 回 · 7 日後に失効" onCopy={onCopy} />);

    expect(screen.getByText("https://hibari.app/j/7Qv2xkR8mA")).toBeInTheDocument();
    expect(screen.getByText("この画面を閉じると再表示できません。いま控えておいてください。")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "コピー" }));
    expect(onCopy).toHaveBeenCalledOnce();
  });
});
