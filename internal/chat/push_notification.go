package chat

import (
	"context"
	"encoding/json/v2"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat/authz"
	"github.com/shun2218-dev/hibari/internal/chat/mention"
	"github.com/shun2218-dev/hibari/internal/chat/plaintext"
	"github.com/shun2218-dev/hibari/internal/chat/store"
	"github.com/shun2218-dev/hibari/internal/platform/webpush"
)

// プッシュ通知の「誰に送るか」と「何を送るか」（ADR 0069 決定 5・6・7）。
//
// 送る処理（暗号化・購読ごとの POST・失効の確認）は持たない。PushDelivery（構築順 5）がイベントごとにここを呼び、
// 返った通知を購読ごとに送る。ここを Delivery から切り離すのは、規則をクライアントと同じ表で確かめられる形に保つため。

const (
	// PushMessageTTL はメッセージの通知をプッシュのサービスに預ける時間（決定 6）。それより古い通知は、開けば未読で分かる。
	PushMessageTTL = 24 * time.Hour
	// PushHuddleTTL はハドルの呼び出しを預ける時間（決定 6）。呼び出しは 60 秒で止まる（ADR 0066 決定 11）ので、
	// 遅れて届いた古い呼び出しを出さない。
	PushHuddleTTL = 60 * time.Second

	// pushBodyMax は本文の最大の文字数（ADR 0057 決定 3 と同じ 100 文字）。
	pushBodyMax = 100
	// pushHuddleBody はハドルの呼び出しの本文（docs/ui の「届く通知の中身」）。
	pushHuddleBody = "ハドルを始めました"
)

// PushPayloadType は通知の種類。Service Worker が、まとめる（メッセージ）か、ハドルの画面を開くかを分けるのに使う。
type PushPayloadType string

const (
	PushPayloadMessage PushPayloadType = "message"
	PushPayloadHuddle  PushPayloadType = "huddle"
)

// PushPayload は Service Worker が受け取る JSON（暗号化する前の中身。docs/events.md の「プッシュ通知のペイロード」）。
//
// 本文はサーバーで平文にして、受け取る人ごとに作る（読めない private のチャンネルの名前を出さないため）。
// Service Worker はトークンも設定も持たないので、出すのに要るものはすべてここに入れる。
type PushPayload struct {
	Type  PushPayloadType `json:"type"`
	Title string          `json:"title"`
	Body  string          `json:"body"`
	// Tag は、まとめる単位（決定 7）。メッセージはルームの ID（スレッドの返信なら親の ID）、ハドルの呼び出しはハドルの ID。
	Tag string `json:"tag"`
	// GroupTitle は、同じ Tag の通知をまとめたときのタイトル（「#デザインレビュー」。DM は送信者の名前）。
	GroupTitle string `json:"group_title"`
	// URL は押したときに開く先（アプリの中のパス）。メッセージは ADR 0042 の `?m=`（スレッドなら `&t=`）、ハドルはそのルーム。
	URL string `json:"url"`
}

// PushNotification は 1 人に送る通知 1 件。PushDelivery が、その人の購読ごとに Message を送る。
type PushNotification struct {
	UserID ulid.ULID
	// Reasons はメッセージの通知の理由（アクティビティと同じ値。ハドルの呼び出しでは nil）。
	Reasons []ActivityReason
	// Message の Payload は PushPayload の JSON で、webpush.MaxPayload に収めてある。
	Message webpush.Message
}

// PushNotifications は、コミット済みのイベントから送るプッシュ通知を決める（ADR 0069 決定 5・6）。
// 送らないイベント（編集・削除・システムメッセージ・ほかの種類）なら nil。
//
// 判定はここで DB を読み直す（ルール 8。WS の接続時の認可や、イベントを作った時点の参加者を使い回さない）。
func (s *Service) PushNotifications(ctx context.Context, ev Event) ([]PushNotification, error) {
	switch ev.Type {
	case EventMessageCreated:
		msg, ok := ev.Data.(Message)
		if !ok {
			return nil, fmt.Errorf("push notifications: unexpected data %T", ev.Data)
		}
		return s.messagePushes(ctx, msg)
	case EventHuddleRinging:
		d, ok := ev.Data.(HuddleRinging)
		if !ok {
			return nil, fmt.Errorf("push notifications: unexpected data %T", ev.Data)
		}
		return s.huddlePushes(ctx, d, ev.To.Users)
	}
	return nil, nil
}

// pushSettings は、送る相手の候補 1 人の、判定に使う値（ListPushCandidates の 1 行）。
type pushSettings struct {
	UserID ulid.ULID
	// Global はワークスペースの全体の設定。nil なら未設定（mentions）。
	Global *string
	// Room はチャンネルごとの設定。期限の来たミュートは roomNotificationsOf が落としてある。
	Room *RoomNotifications
	// ThreadNotifyReplies は、スレッドの返信なら参加者の行の返信の通知。参加していなければ nil。
	ThreadNotifyReplies *bool
}

func pushSettingsOf(r store.ListPushCandidatesRow, now time.Time) pushSettings {
	return pushSettings{
		UserID:              r.UserID,
		Global:              r.WorkspaceLevel,
		Room:                roomNotificationsOf(r.RoomLevel, r.Muted, r.MutedUntil, now),
		ThreadNotifyReplies: r.ThreadNotifyReplies,
	}
}

// pushReasons は、そのメッセージをその人に通知する理由。空なら送らない（ADR 0069 決定 5）。
//
// クライアントの notifyReasons（web/lib/chat/notifications/desktop-notification.ts）の countHere: false と同じ規則で、
// 規則の表（testdata/notification-rules.json）を両方のテストが読む。違うのは「どのタブも見えていない」の代わりに
// presence を見ることだけで、それは呼ぶ側（messagePushes）が行う。
//
//   - ミュートしている → 送らない（メンションでも）
//   - DM → 全体が none でなければ送る
//   - それ以外は「通知する内容」（チャンネルの上書き、なければ全体の設定）で決める
//     all: チャンネルの投稿はすべて。スレッドだけの返信は、メンションかスレッドに当たるときだけ / mentions: メンションかスレッド / none: 送らない
//   - スレッド: 返信で、参加していて返信の通知がオン
//   - `@here` は理由にしない（送る相手は active ではない人なので、@here の対象に入っていない。決定 5）
func pushReasons(msg Message, roomKind RoomKind, st pushSettings) []ActivityReason {
	if msg.Kind != MessageKindUser || msg.Sender.ID == st.UserID || msg.DeletedAt != nil {
		return nil
	}
	if st.Room == nil || st.Room.Muted {
		return nil
	}
	global := notifyLevelOf(st.Global)
	reply := msg.ThreadRootID != nil
	var reasons []ActivityReason
	if roomKind == authz.RoomDM {
		if global == NotifyNone {
			return nil
		}
		reasons = append(reasons, ReasonDM)
	} else {
		effective := global
		if st.Room.Level != nil {
			effective = *st.Room.Level
		}
		if effective == NotifyNone {
			return nil
		}
		// チャンネルにも出した返信は、チャンネルの投稿としても判定する（ADR 0056 決定 3）
		if effective == NotifyAll && (!reply || msg.AlsoInChannel) {
			reasons = append(reasons, ReasonChannel)
		}
	}
	if mentionsUser(msg.Mentions, st.UserID) {
		reasons = append(reasons, ReasonMention)
	}
	if reply && st.ThreadNotifyReplies != nil && *st.ThreadNotifyReplies {
		reasons = append(reasons, ReasonThread)
	}
	slices.Sort(reasons)
	return reasons
}

// mentionsUser は自分宛てか。`<@自分>` と `@channel`（`@here` は数えない。pushReasons の説明）。
func mentionsUser(ms []Mention, userID ulid.ULID) bool {
	for _, m := range ms {
		if m.Kind == mention.KindChannel || m.Kind == mention.KindUser && m.User != nil && m.User.ID == userID {
			return true
		}
	}
	return false
}

// messagePushes は message.created の通知を決める。
func (s *Service) messagePushes(ctx context.Context, msg Message) ([]PushNotification, error) {
	if msg.Kind != MessageKindUser || msg.DeletedAt != nil {
		return nil, nil
	}
	q := store.New(s.db)
	room, err := q.GetRoom(ctx, msg.RoomID)
	if errors.Is(err, pgx.ErrNoRows) {
		// 送った直後にルームが消えた。送る相手がいない
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get room: %w", err)
	}
	rows, err := q.ListPushCandidates(ctx, store.ListPushCandidatesParams{
		ThreadRootID: msg.ThreadRootID, RoomID: msg.RoomID, SenderID: msg.Sender.ID,
	})
	if err != nil {
		return nil, fmt.Errorf("list push candidates: %w", err)
	}
	now := s.clock.Now()
	kind := RoomKind(room.Kind)
	var (
		ids     []ulid.ULID
		reasons = make(map[ulid.ULID][]ActivityReason, len(rows))
	)
	for _, r := range rows {
		if rs := pushReasons(msg, kind, pushSettingsOf(r, now)); len(rs) > 0 {
			ids = append(ids, r.UserID)
			reasons[r.UserID] = rs
		}
	}
	ids = s.notViewing(ctx, ids)
	if len(ids) == 0 {
		return nil, nil
	}

	channels, err := s.pushChannelNames(ctx, q, room.WorkspaceID, msg.Body, ids)
	if err != nil {
		return nil, err
	}
	users := make(map[string]string, len(msg.Mentions))
	for _, m := range msg.Mentions {
		if m.User != nil {
			users[m.User.ID.String()] = m.User.DisplayName
		}
	}
	out := make([]PushNotification, 0, len(ids))
	for _, id := range ids {
		payload, err := encodePushPayload(messagePayload(msg, room, plaintext.Names{Users: users, Channels: channels.of(id)}))
		if err != nil {
			return nil, err
		}
		out = append(out, PushNotification{
			UserID:  id,
			Reasons: reasons[id],
			Message: webpush.Message{Payload: payload, TTL: PushMessageTTL, Urgency: webpush.UrgencyNormal},
		})
	}
	return out, nil
}

// huddlePushes は huddle.ringing の通知を決める（決定 6）。to はイベントの宛先（DM の相手）。
//
// ミュートした DM では送らない。クライアントの呼び出し（web/lib/chat/store/huddles.ts）と同じで、全体の設定は見ない
// （呼び出しはメッセージの通知ではなく、ADR 0066 決定 11 がミュートだけを条件にしている）。
func (s *Service) huddlePushes(ctx context.Context, d HuddleRinging, to []ulid.ULID) ([]PushNotification, error) {
	q := store.New(s.db)
	room, err := q.GetRoom(ctx, d.RoomID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get room: %w", err)
	}
	rows, err := q.ListPushCandidates(ctx, store.ListPushCandidatesParams{RoomID: d.RoomID, SenderID: d.CallerID})
	if err != nil {
		return nil, fmt.Errorf("list push candidates: %w", err)
	}
	now := s.clock.Now()
	var ids []ulid.ULID
	for _, r := range rows {
		if !slices.Contains(to, r.UserID) || pushSettingsOf(r, now).Room.Muted {
			continue
		}
		ids = append(ids, r.UserID)
	}
	ids = s.notViewing(ctx, ids)
	if len(ids) == 0 {
		return nil, nil
	}
	profiles, err := q.ListUserProfiles(ctx, []ulid.ULID{d.CallerID})
	if err != nil {
		return nil, fmt.Errorf("list user profiles: %w", err)
	}
	if len(profiles) == 0 {
		return nil, nil
	}
	caller := profiles[0].DisplayName
	payload, err := encodePushPayload(PushPayload{
		Type:       PushPayloadHuddle,
		Title:      caller,
		Body:       pushHuddleBody,
		Tag:        d.HuddleID.String(),
		GroupTitle: caller,
		URL:        roomPath(room.WorkspaceID, room.ID),
	})
	if err != nil {
		return nil, err
	}
	out := make([]PushNotification, 0, len(ids))
	for _, id := range ids {
		// 呼び出しは時機を逃すと意味がないので、省電力の端末でもすぐに届けてもらう
		out = append(out, PushNotification{UserID: id, Message: webpush.Message{Payload: payload, TTL: PushHuddleTTL, Urgency: webpush.UrgencyHigh}})
	}
	return out, nil
}

// notViewing は、ids のうち presence が active ではない（どこでも画面を見ていない）人を返す（決定 5）。
//
// 画面を見ている接続が 1 つでもあれば、どの端末にも送らない。見ている画面で読めるため。
// presence を読めなければ、全員を見ていないものとして送る（presenceOf と同じく offline に倒す。
// 見ている画面に重ねて届くほうが、どこにも届かないより害が小さい）。
func (s *Service) notViewing(ctx context.Context, ids []ulid.ULID) []ulid.ULID {
	if len(ids) == 0 {
		return nil
	}
	states, err := s.presence.Presence(ctx, ids)
	if err != nil {
		s.logger.WarnContext(ctx, "read presence for push failed", slog.Int("users", len(ids)), slog.Any("error", err))
		return ids
	}
	return slices.DeleteFunc(slices.Clone(ids), func(id ulid.ULID) bool { return presenceOf(states[id]) == PresenceActive })
}

// pushChannels は、本文のチャンネルへのリンクのうち、受け取る人ごとに読める名前。
type pushChannels struct {
	// public は同じワークスペースの public ルーム（ワークスペースのメンバーなら誰でも読める）。
	public map[string]string
	// private は private ルームの名前と、受け取る人のうちの参加者。
	private map[string]privateChannel
}

type privateChannel struct {
	name    string
	members []ulid.ULID
}

// of は userID が読めるチャンネルの名前の表。private のリンクがなければ、全員で同じ表を使う。
func (c pushChannels) of(userID ulid.ULID) map[string]string {
	if len(c.private) == 0 {
		return c.public
	}
	out := make(map[string]string, len(c.public)+len(c.private))
	for id, name := range c.public {
		out[id] = name
	}
	for id, ch := range c.private {
		if slices.Contains(ch.members, userID) {
			out[id] = ch.name
		}
	}
	return out
}

// pushChannelNames は、本文のチャンネルへのリンクの名前を 1 回のクエリで引く（ADR 0062。受け取る人ごとに読めるものだけ）。
func (s *Service) pushChannelNames(ctx context.Context, q *store.Queries, workspaceID ulid.ULID, body string, userIDs []ulid.ULID) (pushChannels, error) {
	var roomIDs []ulid.ULID
	for _, raw := range plaintext.ChannelIDs(body) {
		// 読めない ID はどのルームでもないので、引かずに「アクセスできないチャンネル」にする
		if id, err := ulid.ParseStrict(raw); err == nil && id.String() == raw && !slices.Contains(roomIDs, id) {
			roomIDs = append(roomIDs, id)
		}
	}
	if len(roomIDs) == 0 {
		return pushChannels{}, nil
	}
	rows, err := q.ListPushChannelLinks(ctx, store.ListPushChannelLinksParams{UserIds: userIDs, RoomIds: roomIDs, WorkspaceID: workspaceID})
	if err != nil {
		return pushChannels{}, fmt.Errorf("list push channel links: %w", err)
	}
	c := pushChannels{public: map[string]string{}, private: map[string]privateChannel{}}
	for _, r := range rows {
		if r.Name == nil {
			continue
		}
		id := r.ID.String()
		if RoomKind(r.Kind) == authz.RoomPublic {
			c.public[id] = *r.Name
			continue
		}
		ch := c.private[id]
		ch.name = *r.Name
		if r.MemberID != nil {
			ch.members = append(ch.members, *r.MemberID)
		}
		c.private[id] = ch
	}
	return c, nil
}

// messagePayload はメッセージの通知の中身（決定 7。docs/ui の「届く通知の中身」）。
//
//   - タイトル: チャンネルは「送信者（#チャンネル）」、スレッドの返信は「送信者（#チャンネル のスレッド）」、DM は送信者だけ
//   - 本文: 平文にした最初の 100 文字。本文がなく添付だけなら「ファイルを N 件送りました: 名前」
//   - Tag: ルームの ID。スレッドの返信は親の ID（スレッドごとにまとめる）
func messagePayload(msg Message, room store.Room, names plaintext.Names) PushPayload {
	sender := msg.Sender.DisplayName
	var place string
	if RoomKind(room.Kind) != authz.RoomDM {
		name := ""
		if room.Name != nil {
			name = *room.Name
		}
		place = "#" + name
		if msg.ThreadRootID != nil {
			place += " のスレッド"
		}
	}
	p := PushPayload{
		Type:       PushPayloadMessage,
		Title:      sender,
		Body:       messagePushBody(msg, names),
		Tag:        room.ID.String(),
		GroupTitle: sender,
		URL:        messagePath(room.WorkspaceID, room.ID, msg.ID, msg.ThreadRootID),
	}
	if place != "" {
		p.Title = sender + "（" + place + "）"
		p.GroupTitle = place
	}
	if msg.ThreadRootID != nil {
		p.Tag = msg.ThreadRootID.String()
	}
	return p
}

// messagePushBody は通知の本文。
func messagePushBody(msg Message, names plaintext.Names) string {
	text := plaintext.Render(msg.Body, names)
	if text == "" && len(msg.Attachments) > 0 {
		files := make([]string, len(msg.Attachments))
		for i, a := range msg.Attachments {
			files[i] = a.FileName
		}
		text = "ファイルを " + strconv.Itoa(len(files)) + " 件送りました: " + strings.Join(files, "、")
	}
	return truncateRunes(text, pushBodyMax)
}

// truncateRunes は s を最初の n 文字にし、切ったら「…」を付ける（ADR 0057 決定 3）。
// 文字は Unicode のコードポイントで数える（Web の slice は UTF-16 で数えるので、絵文字が続くと切る位置が少し違う。
// 絵文字の途中で切って文字化けさせないほうを選ぶ）。
func truncateRunes(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n]) + "…"
}

// messagePath はメッセージのパーマリンク（ADR 0042。Web の permalinkPath と同じ形）。
func messagePath(workspaceID, roomID, messageID ulid.ULID, threadRootID *ulid.ULID) string {
	path := roomPath(workspaceID, roomID) + "?m=" + messageID.String()
	if threadRootID != nil {
		path += "&t=" + threadRootID.String()
	}
	return path
}

// roomPath はルームの画面のパス。
func roomPath(workspaceID, roomID ulid.ULID) string {
	return "/w/" + workspaceID.String() + "/r/" + roomID.String()
}

// encodePushPayload は JSON にして、webpush.MaxPayload に収める。
//
// 本文 100 文字・名前・パスで上限（約 4KB）を超えることはまずないが、表示名やルームの名前の長さはここでは決められないので、
// 超えたら本文 → タイトル → まとめたときのタイトルの順に後ろから削る。暗号化の段で ErrPayloadTooLarge にして通知ごと落とすより、
// 短くても届くほうがよい。
func encodePushPayload(p PushPayload) ([]byte, error) {
	for {
		b, err := json.Marshal(p)
		if err != nil {
			return nil, fmt.Errorf("marshal push payload: %w", err)
		}
		over := len(b) - webpush.MaxPayload
		if over <= 0 {
			return b, nil
		}
		switch {
		case p.Body != "":
			p.Body = shrink(p.Body, over)
		case p.Title != "":
			p.Title = shrink(p.Title, over)
		case p.GroupTitle != "":
			p.GroupTitle = shrink(p.GroupTitle, over)
		default:
			return nil, fmt.Errorf("push payload too large: %d bytes", len(b))
		}
	}
}

// shrink は s の後ろから、少なくとも over バイトを削って「…」を付ける。削り切ったら空にする。
// JSON のエスケープで 1 文字が数バイトに増えることがあるので、足りなければ encodePushPayload がもう一度呼ぶ。
func shrink(s string, over int) string {
	s = strings.TrimSuffix(s, "…")
	cut := len(s)
	for removed := 0; cut > 0 && removed < over+len("…"); {
		_, size := utf8.DecodeLastRuneInString(s[:cut])
		cut -= size
		removed += size
	}
	if cut == 0 {
		return ""
	}
	return s[:cut] + "…"
}
