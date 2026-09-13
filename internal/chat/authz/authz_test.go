package authz

import (
	"fmt"
	"testing"
)

// 権限表（ADR 0006 / 0011）のすべてのセルを、許可と拒否の両方で確かめる。
// 期待値は関数の実装から導かず、表を手で書き写す。実装を変えたときに表とのずれを検出するため。

const (
	o = RoleOwner
	a = RoleAdmin
	m = RoleMember
	// none はワークスペースのメンバーではないこと、bogus は DB やリクエストに紛れ込んだ未知の値。
	none  Role = ""
	bogus Role = "superuser"
)

var allRoles = []Role{o, a, m, none, bogus}

func TestParseRole(t *testing.T) {
	for _, tt := range []struct {
		in   string
		want bool
	}{
		{"owner", true}, {"admin", true}, {"member", true},
		{"", false}, {"Owner", false}, {"superuser", false},
	} {
		if _, ok := ParseRole(tt.in); ok != tt.want {
			t.Errorf("ParseRole(%q) ok = %v, want %v", tt.in, ok, tt.want)
		}
	}
}

func TestParseInvitePolicy(t *testing.T) {
	for _, tt := range []struct {
		in   string
		want bool
	}{
		{"admins_only", true}, {"all_members", true}, {"", false}, {"everyone", false},
	} {
		if _, ok := ParseInvitePolicy(tt.in); ok != tt.want {
			t.Errorf("ParseInvitePolicy(%q) ok = %v, want %v", tt.in, ok, tt.want)
		}
	}
}

// pair は (actor, target) の組の期待値。表にない組はすべて拒否。
type pair struct{ actor, target Role }

func checkPairs(t *testing.T, name string, f func(actor, target Role) bool, allowed ...pair) {
	t.Helper()
	allow := map[pair]bool{}
	for _, p := range allowed {
		allow[p] = true
	}
	for _, actor := range allRoles {
		for _, target := range allRoles {
			p := pair{actor, target}
			if got := f(actor, target); got != allow[p] {
				t.Errorf("%s(actor=%q, target=%q) = %v, want %v", name, actor, target, got, allow[p])
			}
		}
	}
}

func TestCanManage(t *testing.T) {
	// owner は admin と member を、admin は member だけを管理できる。同格（admin 同士）は管理できない。
	checkPairs(t, "CanManage", CanManage, pair{o, a}, pair{o, m}, pair{a, m})
}

func TestCanRemoveMember(t *testing.T) {
	checkPairs(t, "CanRemoveMember", CanRemoveMember, pair{o, a}, pair{o, m}, pair{a, m})
}

func TestCanGrant(t *testing.T) {
	// owner は付与できない（譲渡で移す）。自分より上のロールは付与できない。
	checkPairs(t, "CanGrant", CanGrant, pair{o, a}, pair{o, m}, pair{a, a}, pair{a, m}, pair{m, m})
}

func TestCanChangeRole(t *testing.T) {
	type change struct{ actor, target, newRole Role }
	allowed := map[change]bool{
		// owner: admin ↔ member
		{o, a, m}: true, {o, a, a}: true,
		{o, m, a}: true, {o, m, m}: true,
		// admin: member → admin（他の admin は降格できない）
		{a, m, a}: true, {a, m, m}: true,
	}
	for _, actor := range allRoles {
		for _, target := range allRoles {
			for _, newRole := range allRoles {
				c := change{actor, target, newRole}
				if got := CanChangeRole(actor, target, newRole); got != allowed[c] {
					t.Errorf("CanChangeRole(%q, %q, %q) = %v, want %v", actor, target, newRole, got, allowed[c])
				}
			}
		}
	}
}

// checkRoles は 1 引数のロールの判定を確かめる。
func checkRoles(t *testing.T, name string, f func(Role) bool, allowed ...Role) {
	t.Helper()
	allow := map[Role]bool{}
	for _, r := range allowed {
		allow[r] = true
	}
	for _, r := range allRoles {
		if got := f(r); got != allow[r] {
			t.Errorf("%s(%q) = %v, want %v", name, r, got, allow[r])
		}
	}
}

func TestWorkspaceRoleOnly(t *testing.T) {
	checkRoles(t, "IsMember", Role.IsMember, o, a, m)
	checkRoles(t, "CanLeaveWorkspace", CanLeaveWorkspace, a, m)
	checkRoles(t, "CanUpdateWorkspace", CanUpdateWorkspace, o, a)
	checkRoles(t, "CanTransferOwnership", CanTransferOwnership, o)
	checkRoles(t, "CanListInvites", CanListInvites, o, a, m)
	checkRoles(t, "CanCreateRoom", CanCreateRoom, o, a, m)
}

func TestCanCreateInvite(t *testing.T) {
	checkRoles(t, "CanCreateInvite(admins_only)",
		func(r Role) bool { return CanCreateInvite(r, InvitePolicyAdminsOnly) }, o, a)
	checkRoles(t, "CanCreateInvite(all_members)",
		func(r Role) bool { return CanCreateInvite(r, InvitePolicyAllMembers) }, o, a, m)
	// 未知のポリシーでは member に許さない。
	checkRoles(t, "CanCreateInvite(unknown)",
		func(r Role) bool { return CanCreateInvite(r, InvitePolicy("everyone")) }, o, a)
}

func TestCanRevokeInvite(t *testing.T) {
	for _, tt := range []struct {
		policy    InvitePolicy
		isCreator bool
		allowed   []Role
	}{
		// admin 以上は誰の招待でも取り消せる。
		{InvitePolicyAdminsOnly, false, []Role{o, a}},
		{InvitePolicyAllMembers, false, []Role{o, a}},
		// member は自分の招待を、いまも作成できるときだけ取り消せる。
		{InvitePolicyAllMembers, true, []Role{o, a, m}},
		// all_members から admins_only に戻されたら、member は自分の招待も取り消せない（admin に任せる）。
		{InvitePolicyAdminsOnly, true, []Role{o, a}},
	} {
		name := fmt.Sprintf("CanRevokeInvite(%s, creator=%v)", tt.policy, tt.isCreator)
		checkRoles(t, name, func(r Role) bool { return CanRevokeInvite(r, tt.policy, tt.isCreator) }, tt.allowed...)
	}
}

// roomCase はルームに対する actor の立場の組み合わせ。
type roomCase struct {
	kind         RoomKind
	role         Role
	isRoomMember bool
}

var allKinds = []RoomKind{RoomPublic, RoomPrivate, RoomDM, RoomKind("group")}

// checkRoom はルームの判定を、種類 × ロール × ルームのメンバーかどうかの全組み合わせで確かめる。
func checkRoom(t *testing.T, name string, f func(RoomKind, RoomActor) bool, allowed func(roomCase) bool) {
	t.Helper()
	for _, kind := range allKinds {
		for _, role := range allRoles {
			for _, isRoomMember := range []bool{false, true} {
				c := roomCase{kind, role, isRoomMember}
				if got, want := f(kind, RoomActor{Role: role, IsRoomMember: isRoomMember}), allowed(c); got != want {
					t.Errorf("%s(kind=%q, role=%q, room_member=%v) = %v, want %v", name, kind, role, isRoomMember, got, want)
				}
			}
		}
	}
}

func isWorkspaceMember(r Role) bool { return r == o || r == a || r == m }

func TestCanReadRoom(t *testing.T) {
	checkRoom(t, "CanReadRoom", CanReadRoom, func(c roomCase) bool {
		switch {
		case !isWorkspaceMember(c.role):
			return false // ワークスペースを抜けたら、room_members が残っていても読めない
		case c.kind == RoomPublic:
			return true // 参加していなくても読める
		case c.kind == RoomPrivate, c.kind == RoomDM:
			return c.isRoomMember
		default:
			return false
		}
	})
}

func TestCanWriteRoom(t *testing.T) {
	checkRoom(t, "CanWriteRoom", CanWriteRoom, func(c roomCase) bool {
		// public でも投稿には参加が必要。
		known := c.kind == RoomPublic || c.kind == RoomPrivate || c.kind == RoomDM
		return known && isWorkspaceMember(c.role) && c.isRoomMember
	})
}

func TestCanJoinRoom(t *testing.T) {
	checkRoom(t, "CanJoinRoom", CanJoinRoom, func(c roomCase) bool {
		return c.kind == RoomPublic && isWorkspaceMember(c.role)
	})
}

func TestCanAddRoomMember(t *testing.T) {
	checkRoom(t, "CanAddRoomMember", CanAddRoomMember, func(c roomCase) bool {
		// private のメンバーならロールに関係なく追加できる。
		return c.kind == RoomPrivate && isWorkspaceMember(c.role) && c.isRoomMember
	})
}

func TestCanUpdateRoom(t *testing.T) {
	checkRoom(t, "CanUpdateRoom", CanUpdateRoom, func(c roomCase) bool {
		adminOrAbove := c.role == o || c.role == a
		switch c.kind {
		case RoomPublic:
			return adminOrAbove
		case RoomPrivate:
			return adminOrAbove && c.isRoomMember // 読めない private は変更できない
		default:
			return false // dm と未知の種類
		}
	})
}

func TestCanLeaveRoom(t *testing.T) {
	checkRoom(t, "CanLeaveRoom", CanLeaveRoom, func(c roomCase) bool {
		return (c.kind == RoomPublic || c.kind == RoomPrivate) && isWorkspaceMember(c.role) && c.isRoomMember
	})
}

func TestCanRemoveRoomMember(t *testing.T) {
	for _, target := range allRoles {
		checkRoom(t, fmt.Sprintf("CanRemoveRoomMember(target=%q)", target),
			func(k RoomKind, ra RoomActor) bool { return CanRemoveRoomMember(k, ra, target) },
			func(c roomCase) bool {
				manages := (c.role == o && (target == a || target == m)) || (c.role == a && target == m)
				switch c.kind {
				case RoomPublic:
					return manages
				case RoomPrivate:
					return manages && c.isRoomMember
				default:
					return false
				}
			})
	}
}

func TestCanMarkRoomRead(t *testing.T) {
	checkRoom(t, "CanMarkRoomRead", CanMarkRoomRead, func(c roomCase) bool {
		// 既読位置は room_members にあるので、参加していない public では更新できない。
		known := c.kind == RoomPublic || c.kind == RoomPrivate || c.kind == RoomDM
		return known && isWorkspaceMember(c.role) && c.isRoomMember
	})
}

func TestCanEditMessage(t *testing.T) {
	checkRoom(t, "CanEditMessage(sender)", func(k RoomKind, ra RoomActor) bool { return CanEditMessage(k, ra, true) },
		func(c roomCase) bool {
			known := c.kind == RoomPublic || c.kind == RoomPrivate || c.kind == RoomDM
			return known && isWorkspaceMember(c.role) && c.isRoomMember
		})
	// 他人のメッセージは owner でも編集できない。
	checkRoom(t, "CanEditMessage(not sender)", func(k RoomKind, ra RoomActor) bool { return CanEditMessage(k, ra, false) },
		func(roomCase) bool { return false })
}

func TestCanDeleteMessage(t *testing.T) {
	checkRoom(t, "CanDeleteMessage(sender)", func(k RoomKind, ra RoomActor) bool { return CanDeleteMessage(k, ra, true, m) },
		func(c roomCase) bool {
			known := c.kind == RoomPublic || c.kind == RoomPrivate || c.kind == RoomDM
			return known && isWorkspaceMember(c.role) && c.isRoomMember
		})
	for _, sender := range allRoles {
		checkRoom(t, fmt.Sprintf("CanDeleteMessage(sender role=%q)", sender),
			func(k RoomKind, ra RoomActor) bool { return CanDeleteMessage(k, ra, false, sender) },
			func(c roomCase) bool {
				// owner は admin と member の、admin は member の投稿を消せる。抜けた人（none / 未知の値）の投稿は admin 以上なら消せる。
				departed := sender == none || sender == bogus
				manages := (c.role == o && (sender == a || sender == m || departed)) || (c.role == a && (sender == m || departed))
				switch c.kind {
				case RoomPublic:
					return manages // 参加していなくても読めるので消せる
				case RoomPrivate:
					return manages && c.isRoomMember
				default:
					return false // dm と未知の種類
				}
			})
	}
}

func TestCanUploadAttachment(t *testing.T) {
	checkRoom(t, "CanUploadAttachment", CanUploadAttachment, func(c roomCase) bool {
		// 投稿できる人だけ。参加していない public ではアップロードできない。
		known := c.kind == RoomPublic || c.kind == RoomPrivate || c.kind == RoomDM
		return known && isWorkspaceMember(c.role) && c.isRoomMember
	})
}

func TestCanCompleteAttachment(t *testing.T) {
	if !CanCompleteAttachment(true) || CanCompleteAttachment(false) {
		t.Error("CanCompleteAttachment must allow only the uploader")
	}
}

func TestCanViewAttachment(t *testing.T) {
	checkRoom(t, "CanViewAttachment", CanViewAttachment, func(c roomCase) bool {
		switch c.kind {
		case RoomPublic:
			return isWorkspaceMember(c.role) // 参加していなくても読める
		case RoomPrivate, RoomDM:
			return isWorkspaceMember(c.role) && c.isRoomMember
		default:
			return false
		}
	})
}
