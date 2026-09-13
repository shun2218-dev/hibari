// Package authz は「このユーザーはこのワークスペース / ルームに対して何ができるか」を判定する（CLAUDE.md ルール 9）。
//
// 判定はすべてここに集め、ハンドラやサービスに散らさない。関数は DB に触らない純粋な関数にして、
// 判定に必要な事実（ロール、ルームのメンバーかどうか）は呼び出し側が読んで渡す。
// こうしておくと、権限表（ADR 0006 / 0011）のすべてのセルを DB なしのテーブル駆動テストで確かめられる。
//
// どの関数も、ロールが空（ワークスペースのメンバーではない）や未知の値なら拒否する。
package authz

// Role はワークスペース単位の固定ロール（ADR 0006）。空文字列は「メンバーではない」を表す。
type Role string

const (
	RoleOwner  Role = "owner"
	RoleAdmin  Role = "admin"
	RoleMember Role = "member"
)

// ParseRole は DB やリクエストの文字列をロールにする。未知の値なら ok が false。
func ParseRole(s string) (Role, bool) {
	r := Role(s)
	return r, r.rank() > 0
}

// rank はロールの上下を比較するための値。メンバーでない・未知のロールは 0。
func (r Role) rank() int {
	switch r {
	case RoleOwner:
		return 3
	case RoleAdmin:
		return 2
	case RoleMember:
		return 1
	default:
		return 0
	}
}

// IsMember はワークスペースのメンバーかどうかを返す。
func (r Role) IsMember() bool { return r.rank() > 0 }

// InvitePolicy は招待リンクを作成できる人の設定。
type InvitePolicy string

const (
	InvitePolicyAdminsOnly InvitePolicy = "admins_only"
	InvitePolicyAllMembers InvitePolicy = "all_members"
)

// ParseInvitePolicy は文字列を InvitePolicy にする。未知の値なら ok が false。
func ParseInvitePolicy(s string) (InvitePolicy, bool) {
	p := InvitePolicy(s)
	return p, p == InvitePolicyAdminsOnly || p == InvitePolicyAllMembers
}

// ---- ワークスペース ----

// CanManage は actor が target を管理できる（キック・ロール変更の対象にできる）かを返す。
// ロールが厳密に上のときだけ許す。同格を許すと、admin 同士で降格し合える。
func CanManage(actor, target Role) bool {
	return actor.IsMember() && target.IsMember() && actor.rank() > target.rank()
}

// CanGrant は actor が role を付与できるかを返す。
// 自分より上のロールは付与できず、owner は付与ではなく譲渡で移す。
func CanGrant(actor, role Role) bool {
	return actor.IsMember() && role.IsMember() && role != RoleOwner && role.rank() <= actor.rank()
}

// CanChangeRole は actor が target のロールを newRole に変えられるかを返す。
func CanChangeRole(actor, target, newRole Role) bool {
	return CanManage(actor, target) && CanGrant(actor, newRole)
}

// CanRemoveMember は actor が target をワークスペースからキックできるかを返す。自分自身の退出は CanLeaveWorkspace。
func CanRemoveMember(actor, target Role) bool {
	return CanManage(actor, target)
}

// CanLeaveWorkspace は自分で退出できるかを返す。owner は譲渡するまで退出できない（ワークスペースを owner 不在にしない）。
func CanLeaveWorkspace(actor Role) bool {
	return actor.IsMember() && actor != RoleOwner
}

// CanUpdateWorkspace は名前と invite_policy を変更できるかを返す。
func CanUpdateWorkspace(actor Role) bool {
	return actor.rank() >= RoleAdmin.rank()
}

// CanTransferOwnership は owner を譲渡できるかを返す。
func CanTransferOwnership(actor Role) bool {
	return actor == RoleOwner
}

// ---- 招待 ----

// CanCreateInvite は招待リンクを作成できるかを返す。
func CanCreateInvite(actor Role, policy InvitePolicy) bool {
	if actor.rank() >= RoleAdmin.rank() {
		return true
	}
	return actor == RoleMember && policy == InvitePolicyAllMembers
}

// CanListInvites は招待リンクの一覧を見られるかを返す。一覧にコードは含まれない（ADR 0011）。
func CanListInvites(actor Role) bool {
	return actor.IsMember()
}

// CanRevokeInvite は招待リンクを取り消せるかを返す。
// admin 以上は誰の招待でも取り消せる。それ以外は、自分が作成した招待で、いまも作成できる場合だけ。
// 「作成できる人は誰の招待でも取り消せる」にすると、all_members のときに member が admin の招待を消せてしまう（ADR 0011）。
func CanRevokeInvite(actor Role, policy InvitePolicy, isCreator bool) bool {
	if actor.rank() >= RoleAdmin.rank() {
		return true
	}
	return isCreator && CanCreateInvite(actor, policy)
}

// ---- ルーム ----

// RoomKind はルームの種類。
type RoomKind string

const (
	RoomPublic  RoomKind = "public"
	RoomPrivate RoomKind = "private"
	RoomDM      RoomKind = "dm"
)

// RoomActor は、あるルームに対する actor の立場。
type RoomActor struct {
	// Role はルームが属するワークスペースでのロール。空ならワークスペースのメンバーではない。
	Role Role
	// IsRoomMember はルームの room_members に行があるか。
	IsRoomMember bool
}

// CanCreateRoom はルームを作成できるかを返す。DM もワークスペースのメンバーなら誰でも作れる。
func CanCreateRoom(actor Role) bool {
	return actor.IsMember()
}

// CanReadRoom はルームのメッセージとメンバーを読めるかを返す。
// public はワークスペースのメンバーなら参加していなくても読める。private / dm はルームのメンバーだけ。
func CanReadRoom(kind RoomKind, a RoomActor) bool {
	if !a.Role.IsMember() {
		return false
	}
	switch kind {
	case RoomPublic:
		return true
	case RoomPrivate, RoomDM:
		return a.IsRoomMember
	default:
		return false
	}
}

// CanWriteRoom はルームに投稿できるかを返す。public でも投稿には参加が必要。
func CanWriteRoom(kind RoomKind, a RoomActor) bool {
	return CanReadRoom(kind, a) && a.IsRoomMember
}

// CanJoinRoom は自分でルームに参加できるかを返す。自分で参加できるのは public だけ。
func CanJoinRoom(kind RoomKind, a RoomActor) bool {
	return kind == RoomPublic && a.Role.IsMember()
}

// CanAddRoomMember は他人をルームに追加できるかを返す。private のメンバーなら誰でも追加できる。
// public は各自が参加し、dm のメンバーは作成時の 2 人で固定する。
func CanAddRoomMember(kind RoomKind, a RoomActor) bool {
	return kind == RoomPrivate && CanReadRoom(kind, a)
}

// CanUpdateRoom はルームの設定（name / is_default）を変更できるかを返す。
// is_default は以降に参加する全員に効くので admin 以上に限る。読めないルーム（参加していない private）は変更できない。
func CanUpdateRoom(kind RoomKind, a RoomActor) bool {
	return kind != RoomDM && a.Role.rank() >= RoleAdmin.rank() && CanReadRoom(kind, a)
}

// CanRemoveRoomMember は他人をルームから外せるかを返す。自分で抜けるのは CanLeaveRoom。
// ロールが target より上で、かつそのルームを読めること（private ならメンバーであること）が必要。
func CanRemoveRoomMember(kind RoomKind, a RoomActor, target Role) bool {
	return kind != RoomDM && CanManage(a.Role, target) && CanReadRoom(kind, a)
}

// CanLeaveRoom は自分でルームから抜けられるかを返す。dm からは抜けられない。
func CanLeaveRoom(kind RoomKind, a RoomActor) bool {
	return (kind == RoomPublic || kind == RoomPrivate) && a.Role.IsMember() && a.IsRoomMember
}

// CanMarkRoomRead は既読位置を更新できるかを返す。既読位置は room_members の行にあるので、参加していない public は対象外。
func CanMarkRoomRead(kind RoomKind, a RoomActor) bool {
	return CanReadRoom(kind, a) && a.IsRoomMember
}

// ---- メッセージ ----

// CanEditMessage はメッセージを編集できるかを返す。送信者本人で、いまも投稿できる場合だけ（ADR 0012）。
// 他人の本文を書き換えられると、発言の主体が分からなくなるので、admin 以上にも許さない。
func CanEditMessage(kind RoomKind, a RoomActor, isSender bool) bool {
	return isSender && CanWriteRoom(kind, a)
}

// CanDeleteMessage はメッセージを削除できるかを返す（ADR 0012）。
//
//   - 送信者本人は、いまも投稿できるなら削除できる。
//   - それ以外は、ルームを読める admin 以上で、送信者を管理できる（CanManage）場合だけ。荒らしの投稿を消すため。
//     送信者がワークスペースを抜けていれば（senderRole が空）、admin 以上なら削除できる。抜けた人の投稿を誰も消せなくなるのを避ける。
//   - dm では他人のメッセージを削除できない。dm は 2 人だけの場で、管理の対象にしない。
func CanDeleteMessage(kind RoomKind, a RoomActor, isSender bool, senderRole Role) bool {
	if isSender {
		return CanWriteRoom(kind, a)
	}
	if kind == RoomDM || a.Role.rank() < RoleAdmin.rank() || !CanReadRoom(kind, a) {
		return false
	}
	return !senderRole.IsMember() || CanManage(a.Role, senderRole)
}

// ---- 添付ファイル ----

// CanUploadAttachment は、ルームに添付ファイルをアップロードする URL を発行できるかを返す（ADR 0013）。
// アップロードは投稿の準備なので、投稿できる人に限る。読めるだけの人（参加していない public）がストレージに書き込めると、容量を使うだけの操作ができてしまう。
func CanUploadAttachment(kind RoomKind, a RoomActor) bool {
	return CanWriteRoom(kind, a)
}

// CanCompleteAttachment はアップロードの完了（HEAD による検証）を報告できるかを返す。アップロードした本人だけ。
func CanCompleteAttachment(isUploader bool) bool {
	return isUploader
}

// CanViewAttachment は、メッセージに付いた添付ファイルの GET URL を取得できるかを返す。メッセージを読める人なら取得できる。
func CanViewAttachment(kind RoomKind, a RoomActor) bool {
	return CanReadRoom(kind, a)
}
