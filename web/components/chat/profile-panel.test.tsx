import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ProfilePanel } from "./profile-panel";
import type { ProfileView } from "./types";

type MemberCard = Extract<ProfileView, { kind: "member" }>;

function member(overrides: Partial<MemberCard> = {}): MemberCard {
  return {
    kind: "member",
    user: { id: "01J8ZH5K000000000000000002", name: "佐藤 直樹", handle: "naoki" },
    presence: "online",
    role: "owner",
    email: { state: "ready", value: "naoki@example.com" },
    isSelf: false,
    ...overrides,
  };
}

const former: ProfileView = {
  kind: "former",
  user: { id: "01J8ZH5K00000000000000000H", name: "森田 圭", handle: "kei" },
};

describe("ProfilePanel（ADR 0050）", () => {
  it("名前・handle・ロール・presence・email を出し、主ボタンは「DM を送る」", async () => {
    const onSendDm = vi.fn();
    render(<ProfilePanel profile={member()} onSendDm={onSendDm} />);

    expect(screen.getByText("佐藤 直樹")).toBeInTheDocument();
    expect(screen.getByText("@naoki")).toBeInTheDocument();
    expect(screen.getByText("オーナー")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "オンライン" })).toBeInTheDocument();
    expect(screen.getByText("naoki@example.com")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "DM を送る" }));
    expect(onSendDm).toHaveBeenCalledOnce();
  });

  it("オフラインは、ドットも文言も出さない（最終オンライン時刻も出さない。ADR 0049）", () => {
    render(<ProfilePanel profile={member({ presence: "offline" })} />);

    expect(screen.queryByRole("img", { name: /オンライン|離席中|オフライン/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/オフライン/)).not.toBeInTheDocument();
  });

  it("カスタムステータスは、文言と期限までそのまま読める", () => {
    render(
      <ProfilePanel
        profile={member({
          user: {
            id: "01J8ZH5K000000000000000002",
            name: "佐藤 直樹",
            handle: "naoki",
            status: { emoji: "📅", text: "会議中", expiresLabel: "11:30 まで" },
          },
        })}
      />,
    );

    expect(screen.getByText("会議中")).toBeInTheDocument();
    expect(screen.getByText(/11:30 まで/)).toBeInTheDocument();
  });

  it("「DM を送る」は応答を待つ間、押せない（決定 4）", () => {
    render(<ProfilePanel profile={member()} dmPending />);

    expect(screen.getByRole("button", { name: "DM を送る" })).toBeDisabled();
  });

  it("email の応答待ちは、読み込み中として行だけ出す", () => {
    render(<ProfilePanel profile={member({ email: { state: "loading" } })} />);

    expect(screen.getByRole("status", { name: "メールアドレスを読み込み中" })).toBeInTheDocument();
  });

  it("email が未検証なら、連絡先もメニューのコピーも出さない（決定 2）", () => {
    render(<ProfilePanel profile={member({ email: { state: "none" } })} menuOpen />);

    expect(screen.queryByRole("region", { name: "連絡先" })).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    const menu = screen.getByRole("dialog", { name: "その他の操作" });
    expect(within(menu).getByRole("button", { name: "ハンドルをコピー" })).toBeInTheDocument();
    expect(within(menu).queryByRole("button", { name: "メールアドレスをコピー" })).not.toBeInTheDocument();
  });

  it("操作できない相手のメニューは、コピーの 2 つだけ", () => {
    render(<ProfilePanel profile={member()} menuOpen />);

    const menu = screen.getByRole("dialog", { name: "その他の操作" });
    expect(within(menu).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "ハンドルをコピー",
      "メールアドレスをコピー",
    ]);
  });

  it("操作できる相手には、ロールの変更と削除を足す（決定 3）", async () => {
    const onChangeRole = vi.fn();
    const onRemove = vi.fn();
    render(
      <ProfilePanel
        profile={member({ role: "member", manage: { grantableRoles: ["admin", "member"], canRemove: true } })}
        menuOpen
        onChangeRole={onChangeRole}
        onRemove={onRemove}
      />,
    );

    const menu = screen.getByRole("dialog", { name: "その他の操作" });
    expect(within(menu).getByRole("button", { name: "メンバー" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(within(menu).getByRole("button", { name: "管理者" }));
    expect(onChangeRole).toHaveBeenCalledWith("admin");
    await userEvent.click(within(menu).getByRole("button", { name: "ワークスペースから削除" }));
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it("自分のカードは「DM を送る」の代わりに「プロフィールを編集」", async () => {
    const onEditProfile = vi.fn();
    render(<ProfilePanel profile={member({ isSelf: true })} onEditProfile={onEditProfile} />);

    expect(screen.queryByRole("button", { name: "DM を送る" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "プロフィールを編集" }));
    expect(onEditProfile).toHaveBeenCalledOnce();
  });

  it("外された人は、名前と handle だけの縮めたカードにする（決定 5）", async () => {
    const onCopyHandle = vi.fn();
    render(<ProfilePanel profile={former} onCopyHandle={onCopyHandle} />);

    expect(screen.getByText("森田 圭")).toBeInTheDocument();
    expect(screen.getByText("このワークスペースのメンバーではありません")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "DM を送る" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "その他の操作" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "ハンドルをコピー" }));
    expect(onCopyHandle).toHaveBeenCalledOnce();
  });

  it("メンバーから開いたときだけ「メンバーに戻る」を出す", async () => {
    const onBack = vi.fn();
    const { rerender } = render(<ProfilePanel profile={member()} />);
    expect(screen.queryByRole("button", { name: "メンバーに戻る" })).not.toBeInTheDocument();

    rerender(<ProfilePanel profile={member()} onBack={onBack} />);
    await userEvent.click(screen.getByRole("button", { name: "メンバーに戻る" }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("開き直して手がかりがないときは、メンバーではないことだけを出す", () => {
    render(<ProfilePanel profile={{ kind: "unknown" }} />);

    expect(screen.getByText("このワークスペースのメンバーではありません。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /DM|コピー/ })).not.toBeInTheDocument();
  });
});
