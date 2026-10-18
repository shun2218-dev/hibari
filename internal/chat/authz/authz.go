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

// CanViewMemberProfile は、同じワークスペースのメンバーのプロフィール（email を含む）を見られるかを返す。
// メンバーなら誰でも見られる（email を同じワークスペースの全員に見せるのはオーナーの判断。ADR 0050）。
func CanViewMemberProfile(actor Role) bool {
	return actor.IsMember()
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

// Room は authz が見るルームの情報（ADR 0059 決定 2）。
//
// 種類だけでなく状態も渡すのは、アーカイブのように「ルームの状態によって、誰であってもできなくなる操作」があるため。
// 判定をハンドラやサービスの `if archived` に散らさず、ここに集める（CLAUDE.md ルール 9）。
// すべてのルームの関数がこの型を受け取るので、呼ぶ側は状態を渡さずに呼べない。
type Room struct {
	Kind      RoomKind
	IsDefault bool
	Archived  bool
}

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
func CanReadRoom(r Room, a RoomActor) bool {
	if !a.Role.IsMember() {
		return false
	}
	switch r.Kind {
	case RoomPublic:
		return true
	case RoomPrivate, RoomDM:
		return a.IsRoomMember
	default:
		return false
	}
}

// CanWriteRoom はルームに投稿できるかを返す。public でも投稿には参加が必要。
// アーカイブ中は誰も投稿できない（ADR 0059 決定 2）。ピン留め・アップロード・編集・typing もこの判定に乗るので、まとめて止まる。
func CanWriteRoom(r Room, a RoomActor) bool {
	return !r.Archived && CanReadRoom(r, a) && a.IsRoomMember
}

// CanPinMessage はメッセージをピン留めできる・外せるかを返す（ADR 0054 決定 4）。
// いまは投稿できる人なら誰でも（Slack の既定と同じ）。判定を別の関数にしておくのは、
// あとで「admin 以上だけ」に絞るときに、呼ぶ側を直さずに済むようにするため（CanMentionAll と同じ）。
func CanPinMessage(r Room, a RoomActor) bool {
	return CanWriteRoom(r, a)
}

// CanJoinRoom は自分でルームに参加できるかを返す。自分で参加できるのは public だけ。
// アーカイブ中は参加できない（ADR 0059 決定 2。メンバーが増えるのはルームの状態の変更）。
func CanJoinRoom(r Room, a RoomActor) bool {
	return !r.Archived && r.Kind == RoomPublic && a.Role.IsMember()
}

// CanAddRoomMember は他人をルームに追加できるかを返す。private のメンバーなら誰でも追加できる。
// public は各自が参加し、dm のメンバーは作成時の 2 人で固定する。
func CanAddRoomMember(r Room, a RoomActor) bool {
	return !r.Archived && r.Kind == RoomPrivate && CanReadRoom(r, a)
}

// CanUpdateRoom はルームの設定（name / is_default）を変更できるかを返す。
// is_default は以降に参加する全員に効くので admin 以上に限る。読めないルーム（参加していない private）は変更できない。
// アーカイブ中は変更できない（ADR 0059 決定 2）。is_default のルームをアーカイブできないので、アーカイブ中に既定にもできない。
func CanUpdateRoom(r Room, a RoomActor) bool {
	return !r.Archived && r.Kind != RoomDM && a.Role.rank() >= RoleAdmin.rank() && CanReadRoom(r, a)
}

// CanRemoveRoomMember は他人をルームから外せるかを返す。自分で抜けるのは CanLeaveRoom。
// ロールが target より上で、かつそのルームを読めること（private ならメンバーであること）が必要。
func CanRemoveRoomMember(r Room, a RoomActor, target Role) bool {
	return !r.Archived && r.Kind != RoomDM && CanManage(a.Role, target) && CanReadRoom(r, a)
}

// CanLeaveRoom は自分でルームから抜けられるかを返す。dm からは抜けられない。
// アーカイブ中も抜けられる（ADR 0059 決定 2。本人だけの状態で、ほかの人の画面に何も起こさない）。
func CanLeaveRoom(r Room, a RoomActor) bool {
	return (r.Kind == RoomPublic || r.Kind == RoomPrivate) && a.Role.IsMember() && a.IsRoomMember
}

// CanMarkRoomRead は既読位置を更新できるかを返す。既読位置は room_members の行にあるので、参加していない public は対象外。
func CanMarkRoomRead(r Room, a RoomActor) bool {
	return CanReadRoom(r, a) && a.IsRoomMember
}

// CanSetRoomNotifications はルームごとの通知の設定（ミュートと通知する内容。ADR 0055 決定 3）を変えられるかを返す。
// 設定は room_members の行にあるので、既読位置と同じく、読めるが参加していない public ルームでは持てない。
func CanSetRoomNotifications(r Room, a RoomActor) bool {
	return CanReadRoom(r, a) && a.IsRoomMember
}

// CanFollowThread はスレッドに参加して返信の通知を切り替えられるかを返す（ADR 0056 決定 5）。
// 参加は thread_members の行で、room_members への FK があるので、参加していない public ルームでは持てない。
func CanFollowThread(r Room, a RoomActor) bool {
	return CanReadRoom(r, a) && a.IsRoomMember
}

// CanArchiveRoom はルームをアーカイブできるかを返す（ADR 0059 決定 1）。
// アーカイブは戻せるので広く許す: ルームのメンバーなら誰でも。admin 以上は、読めるルームなら参加していなくても
// （メンバーが全員抜けたルームを片付けられるように）。DM と is_default のルームは対象外。
func CanArchiveRoom(r Room, a RoomActor) bool {
	return !r.Archived && canArchiveOrUnarchive(r, a)
}

// CanUnarchiveRoom はアーカイブを戻せるかを返す。できる人はアーカイブと同じ。
func CanUnarchiveRoom(r Room, a RoomActor) bool {
	return r.Archived && canArchiveOrUnarchive(r, a)
}

func canArchiveOrUnarchive(r Room, a RoomActor) bool {
	if r.Kind == RoomDM || r.IsDefault || !CanReadRoom(r, a) {
		return false
	}
	return a.IsRoomMember || a.Role.rank() >= RoleAdmin.rank()
}

// CanDeleteRoom はルームを削除できるかを返す（ADR 0059 決定 1）。戻せないので admin 以上に絞る（Slack と同じ）。
// アーカイブ中でも削除できる。読めない private は、admin 以上でも削除できない（存在を 404 で隠す。ADR 0011）。
func CanDeleteRoom(r Room, a RoomActor) bool {
	return r.Kind != RoomDM && !r.IsDefault && a.Role.rank() >= RoleAdmin.rank() && CanReadRoom(r, a)
}

// ---- メッセージ ----

// CanEditMessage はメッセージを編集できるかを返す。送信者本人で、いまも投稿できる場合だけ（ADR 0012）。
// 他人の本文を書き換えられると、発言の主体が分からなくなるので、admin 以上にも許さない。
func CanEditMessage(r Room, a RoomActor, isSender bool) bool {
	return isSender && CanWriteRoom(r, a)
}

// CanDeleteMessage はメッセージを削除できるかを返す（ADR 0012）。
//
//   - 送信者本人は、いまも投稿できるなら削除できる。
//   - それ以外は、ルームを読める admin 以上で、送信者を管理できる（CanManage）場合だけ。荒らしの投稿を消すため。
//     送信者がワークスペースを抜けていれば（senderRole が空）、admin 以上なら削除できる。抜けた人の投稿を誰も消せなくなるのを避ける。
//   - dm では他人のメッセージを削除できない。dm は 2 人だけの場で、管理の対象にしない。
func CanDeleteMessage(r Room, a RoomActor, isSender bool, senderRole Role) bool {
	if isSender {
		return CanWriteRoom(r, a)
	}
	if r.Archived || r.Kind == RoomDM || a.Role.rank() < RoleAdmin.rank() || !CanReadRoom(r, a) {
		return false
	}
	return !senderRole.IsMember() || CanManage(a.Role, senderRole)
}

// ---- 添付ファイル ----

// CanUploadAttachment は、ルームに添付ファイルをアップロードする URL を発行できるかを返す（ADR 0013）。
// アップロードは投稿の準備なので、投稿できる人に限る。読めるだけの人（参加していない public）がストレージに書き込めると、容量を使うだけの操作ができてしまう。
func CanUploadAttachment(r Room, a RoomActor) bool {
	return CanWriteRoom(r, a)
}

// CanCompleteAttachment はアップロードの完了（HEAD による検証）を報告できるかを返す。アップロードした本人だけ。
func CanCompleteAttachment(isUploader bool) bool {
	return isUploader
}

// CanViewAttachment は、メッセージに付いた添付ファイルの GET URL を取得できるかを返す。メッセージを読める人なら取得できる。
func CanViewAttachment(r Room, a RoomActor) bool {
	return CanReadRoom(r, a)
}

// ---- WebSocket（ADR 0015） ----

// CanSubscribeWorkspace はワークスペースのイベント（設定・メンバー・presence）を購読できるかを返す。メンバーなら誰でも。
func CanSubscribeWorkspace(actor Role) bool {
	return actor.IsMember()
}

// CanSubscribeRoom はルームのイベント（メッセージ・メンバー・typing）を購読できるかを返す。読める人なら購読できる。
// 購読のたびと権限の変更のたびに判定し、接続したときの結果をキャッシュし続けない（CLAUDE.md ルール 8）。
func CanSubscribeRoom(r Room, a RoomActor) bool {
	return CanReadRoom(r, a)
}

// CanSendTyping は入力中を知らせられるかを返す。投稿できる人だけ（読めるだけの人が「入力中」と表示されないように）。
func CanSendTyping(r Room, a RoomActor) bool {
	return CanWriteRoom(r, a)
}

// ---- ハドル（ADR 0066） ----

// CanJoinHuddle はハドルを始められるか・入れるか・ICE サーバーを取れるかを返す（決定 7）。
// そのルームに投稿できる人だけ。public のチャンネルを読めるだけの人（参加していない人）は、先に参加する。
// アーカイブしたルームでは入れない（呼び出し側は authorize で 409 room-archived にする）。
func CanJoinHuddle(r Room, a RoomActor) bool {
	return CanWriteRoom(r, a)
}
