import { describe, expect, it } from "vitest";

import type { Role } from "@/lib/api/types.gen";
import { invite, member, miyuki, naoki } from "@/test/chat-data";

import {
  MANAGE_LOCKED_REASON,
  canCreateInvite,
  canRevokeInvite,
  grantableRoles,
  inviteUrl,
  toInviteRowView,
  toMemberRowView,
  toProfileView,
  toTransferCandidates,
} from "./workspace-views";

/** 管理画面の時刻の文言は、見る人のタイムゾーンで整形する。テストでは日本時間に固定する。 */
const TZ = "Asia/Tokyo";

describe("permissions (internal/chat/authz と同じ規則)", () => {
  it("lets each role grant only roles at or below its own, never owner", () => {
    expect(grantableRoles("owner")).toEqual(["admin", "member"]);
    expect(grantableRoles("admin")).toEqual(["admin", "member"]);
    expect(grantableRoles("member")).toEqual(["member"]);
  });

  it("allows members to create invites only when the policy says so", () => {
    expect(canCreateInvite("member", "admins_only")).toBe(false);
    expect(canCreateInvite("member", "all_members")).toBe(true);
    expect(canCreateInvite("admin", "admins_only")).toBe(true);
    expect(canCreateInvite("owner", "admins_only")).toBe(true);
  });

  it("lets a member revoke only their own invite, and only while they can create one", () => {
    expect(canRevokeInvite("member", "all_members", true)).toBe(true);
    expect(canRevokeInvite("member", "all_members", false)).toBe(false);
    expect(canRevokeInvite("member", "admins_only", true)).toBe(false);
    expect(canRevokeInvite("admin", "admins_only", false)).toBe(true);
  });
});

describe("toMemberRowView", () => {
  const cases: Array<{ myRole: Role; targetRole: Role; manageable: boolean }> = [
    { myRole: "owner", targetRole: "admin", manageable: true },
    { myRole: "admin", targetRole: "member", manageable: true },
    { myRole: "admin", targetRole: "admin", manageable: false },
    { myRole: "admin", targetRole: "owner", manageable: false },
    { myRole: "member", targetRole: "member", manageable: false },
  ];

  it.each(cases)("$myRole managing $targetRole → $manageable", ({ myRole, targetRole, manageable }) => {
    const view = toMemberRowView(member(miyuki, { role: targetRole }), { userId: naoki.id, myRole });

    expect(view.manage.kind).toBe(manageable ? "menu" : "locked");
    if (view.manage.kind === "menu") expect(view.manage.canRemove).toBe(true);
    else expect(view.manage.reason).toBe(MANAGE_LOCKED_REASON);
  });

  it("never lets the owner manage themselves", () => {
    const view = toMemberRowView(member(naoki, { role: "owner", presence: "active" }), { userId: naoki.id, myRole: "owner" });

    expect(view).toMatchObject({ isSelf: true, presence: "online", manage: { kind: "locked" } });
  });

  it("uses the signed url of the avatar when there is one", () => {
    const urls = { [miyuki.id]: "https://minio.test/avatar.png", [naoki.id]: null };

    expect(toMemberRowView(member(miyuki), { userId: naoki.id, myRole: "owner", avatarUrls: urls }).avatarUrl).toBe(
      "https://minio.test/avatar.png",
    );
    expect(toMemberRowView(member(naoki), { userId: miyuki.id, myRole: "owner", avatarUrls: urls }).avatarUrl).toBeUndefined();
  });
});

describe("toTransferCandidates", () => {
  it("offers everyone but the current owner and the viewer", () => {
    const members = [
      member(naoki, { role: "owner" }),
      member(miyuki, { role: "admin" }),
      member({ ...miyuki, id: "u-3", handle: "kei", display_name: "森田 圭" }),
    ];

    expect(toTransferCandidates(members, naoki.id).map((c) => [c.id, c.role])).toEqual([
      [miyuki.id, "admin"],
      ["u-3", "member"],
    ]);
  });
});

describe("toInviteRowView", () => {
  const viewer = { userId: naoki.id, myRole: "admin" as const, invitePolicy: "admins_only" as const, timeZone: TZ };

  it("writes the uses and the expiry as the design does", () => {
    expect(toInviteRowView(invite("i-1"), viewer)).toMatchObject({
      status: "active",
      createdByName: miyuki.display_name,
      usesLabel: "3 / 10 回使用",
      expiryLabel: "9月20日 18:00 まで",
      canRevoke: true,
    });
  });

  it("says 無制限 when there is no limit, and 失効 once expired", () => {
    const expired = invite("i-2", { max_uses: null, use_count: 1, status: "expired", expires_at: "2026-09-01T03:00:00Z" });

    expect(toInviteRowView(expired, viewer)).toMatchObject({
      usesLabel: "1 / 無制限 回使用",
      expiryLabel: "9月1日 12:00 に失効",
    });
  });

  it("lets a member revoke only their own invite", () => {
    const mine = invite("i-3", { created_by: naoki });
    const asMember = { ...viewer, myRole: "member" as const, invitePolicy: "all_members" as const };

    expect(toInviteRowView(mine, asMember).canRevoke).toBe(true);
    expect(toInviteRowView(invite("i-4"), asMember).canRevoke).toBe(false);
  });
});

describe("inviteUrl", () => {
  it("points at the accept page of the same origin", () => {
    expect(inviteUrl("https://hibari.test", "7Qv2xkR8mA")).toBe("https://hibari.test/j/7Qv2xkR8mA");
  });
});

describe("toProfileView（ADR 0050）", () => {
  const naokiMember = member(naoki, { role: "owner", status: { emoji: "📅", text: "会議中", expires_at: null } });
  const miyukiMember = member(miyuki);

  it("一覧にいる人は、一覧の値に email を足した member にする", () => {
    const view = toProfileView(naokiMember, {
      userId: miyuki.id,
      myRole: "member",
      email: { state: "ready", value: "naoki@example.com" },
      avatarUrls: { [naoki.id]: "https://storage.test/naoki.png" },
    });

    expect(view).toEqual({
      kind: "member",
      user: {
        id: naoki.id,
        name: naoki.display_name,
        handle: naoki.handle,
        avatarUrl: "https://storage.test/naoki.png",
        status: { emoji: "📅", text: "会議中", expiresLabel: undefined },
      },
      presence: "offline",
      role: "owner",
      email: { state: "ready", value: "naoki@example.com" },
      isSelf: false,
      manage: undefined,
    });
  });

  it("管理の入口は、管理画面と同じ写しで操作できる相手のときだけ出す", () => {
    expect(toProfileView(miyukiMember, { userId: naoki.id, myRole: "owner" })).toMatchObject({
      manage: { grantableRoles: ["admin", "member"], canRemove: true },
    });
    // 同格・上のロール・自分・ロールがまだ分からないとき
    expect(toProfileView(miyukiMember, { userId: naoki.id, myRole: "member" })).toMatchObject({ manage: undefined });
    expect(toProfileView(naokiMember, { userId: miyuki.id, myRole: "admin" })).toMatchObject({ manage: undefined });
    expect(toProfileView(naokiMember, { userId: naoki.id, myRole: "owner" })).toMatchObject({ isSelf: true, manage: undefined });
    expect(toProfileView(miyukiMember, { userId: naoki.id, myRole: undefined })).toMatchObject({ manage: undefined });
  });

  it("email は渡されるまで読み込み中", () => {
    expect(toProfileView(miyukiMember, { userId: naoki.id, myRole: "member" })).toMatchObject({ email: { state: "loading" } });
  });

  it("一覧にいない人は、メッセージの送信者の値で former にし、手がかりもなければ unknown", () => {
    expect(toProfileView(undefined, { userId: naoki.id, myRole: "member", fallback: miyuki })).toEqual({
      kind: "former",
      user: { id: miyuki.id, name: miyuki.display_name, handle: miyuki.handle, avatarUrl: undefined },
    });
    expect(toProfileView(undefined, { userId: naoki.id, myRole: "member" })).toEqual({ kind: "unknown" });
  });
});
