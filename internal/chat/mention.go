package chat

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat/mention"
	"github.com/shun2218-dev/hibari/internal/chat/store"
)

// メンション（ADR 0041）。
//
// 本文には ID のトークン（`<@userID>` / `<!channel>` / `<!here>`）を保存し、次の 2 つを別々に作る。
//
//   - 表示: レスポンスの Mentions。**本文から**作る。ルームを抜けた人も含める（名前を出せないと本文が読めない）。
//   - 件数: message_mentions の行。**ルームのメンバーだけ**に作る。数えるのは「既読位置より後の行」。
//
// 2 つを同じ集合から作らないのは、対象が違うため。行だけから表示を作ると、抜けた人のメンションが名前なしになる。

// Mention は本文にあるメンション 1 件（表示用）。
type Mention struct {
	Kind mention.Kind
	// User は Kind が user のときだけ入る。存在しないユーザーの ID は、そもそも Mentions に入らない。
	User *UserProfile
}

// mentionAll は、全員宛てのメンション（@channel / @here）を本文が含むかと、@here の対象。
type mentionAll struct {
	// hereTargets は @here の対象（送った瞬間にオンラインのルームのメンバー）。@here がなければ空。
	hereTargets []ulid.ULID
}

// resolveHere は @here の対象を返す。本文に @here がなければ何もしない。
// スレッドだけの返信でも解決する（対象の人をスレッドに参加させる。ADR 0056 決定 4）。
//
// presence の読み取りは**トランザクションの外**で行う（CLAUDE.md ルール 5 の Redis を、Postgres の行ロックを持ったまま待たない）。
// 読んだ後にオフラインになった人が混ざることはあるが、@here はもともと「送った瞬間の目安」なので許容する（ADR 0041）。
// Redis が読めないときは対象を空にして、本文の送信は続ける。本文が届くことの方が大事なので、送信ごと失敗させない。
func (s *Service) resolveHere(ctx context.Context, logger *slog.Logger, roomID ulid.ULID, body string) mentionAll {
	if !mention.Has(mention.Parse(body), mention.KindHere) || s.presence == nil {
		return mentionAll{}
	}
	members, err := store.New(s.db).ListRoomMemberIDs(ctx, roomID)
	if err != nil {
		logger.WarnContext(ctx, "resolve @here failed; counting it for nobody",
			slog.String("room_id", roomID.String()), slog.Any("error", err))
		return mentionAll{}
	}
	states, err := s.presence.Presence(ctx, members)
	if err != nil {
		logger.WarnContext(ctx, "resolve @here failed; counting it for nobody",
			slog.String("room_id", roomID.String()), slog.Any("error", err))
		return mentionAll{}
	}
	targets := make([]ulid.ULID, 0, len(states))
	for _, id := range members {
		// @here は「いま画面を見ている人」。離席（idle）は含めない（ADR 0049）
		if states[id] == PresenceActive {
			targets = append(targets, id)
		}
	}
	return mentionAll{hereTargets: targets}
}

// createMessageMentions は、本文にあるメンションの行を作る（ADR 0041）。
// 行はルームのメンバーにしか作らない（非メンバーには知らせない）。クエリが room_members を JOIN するので、
// 非メンバーの ID が本文にあっても静かに落ちる。
//
// スレッドだけの返信でも @channel / @here の行を作る（ADR 0056 決定 4。以前はチャンネルに出る本文だけにしていた。ADR 0041）。
// スレッドだけの返信の行は、スレッドに参加している人にしか数えられない（件数の SQL）。参加させるのは送信の側（sendThreadReply）。
func createMessageMentions(ctx context.Context, q *store.Queries, now time.Time, roomID, messageID ulid.ULID, body string, all mentionAll) error {
	ms := mention.Parse(body)
	if len(ms) == 0 {
		return nil
	}
	if ids := mention.UserIDs(ms); len(ids) > 0 {
		if _, err := q.CreateUserMentions(ctx, store.CreateUserMentionsParams{
			RoomID: roomID, MessageID: messageID, UserIds: ids, Kind: string(mention.KindUser), Now: now,
		}); err != nil {
			return fmt.Errorf("create user mentions: %w", err)
		}
	}
	if mention.Has(ms, mention.KindChannel) {
		if err := q.CreateChannelMention(ctx, store.CreateChannelMentionParams{RoomID: roomID, MessageID: messageID, Now: now}); err != nil {
			return fmt.Errorf("create channel mention: %w", err)
		}
	}
	// 対象が 1 人もいない @here（全員オフライン、または presence が読めなかった）では、行を作らない。
	if mention.Has(ms, mention.KindHere) && len(all.hereTargets) > 0 {
		if _, err := q.CreateUserMentions(ctx, store.CreateUserMentionsParams{
			RoomID: roomID, MessageID: messageID, UserIds: all.hereTargets, Kind: string(mention.KindHere), Now: now,
		}); err != nil {
			return fmt.Errorf("create here mentions: %w", err)
		}
	}
	return nil
}

// loadMessageMentions は msgs に表示用の Mentions を載せる。
// 行ではなく**本文**から作り、ユーザーはページ全体で 1 回引く（N+1 にしない）。
func loadMessageMentions(ctx context.Context, q *store.Queries, msgs []Message) error {
	if len(msgs) == 0 {
		return nil
	}
	parsed := make([][]mention.Mention, len(msgs))
	var ids []ulid.ULID
	seen := make(map[ulid.ULID]bool)
	for i := range msgs {
		msgs[i].Mentions = []Mention{}
		parsed[i] = mention.Parse(msgs[i].Body)
		for _, m := range parsed[i] {
			if m.Kind == mention.KindUser && !seen[m.UserID] {
				seen[m.UserID] = true
				ids = append(ids, m.UserID)
			}
		}
	}
	byID := make(map[ulid.ULID]UserProfile, len(ids))
	if len(ids) > 0 {
		profiles, err := q.ListUserProfiles(ctx, ids)
		if err != nil {
			return fmt.Errorf("list mentioned users: %w", err)
		}
		for _, p := range profiles {
			byID[p.ID] = UserProfile{ID: p.ID, Handle: p.Handle, DisplayName: p.DisplayName}
		}
	}
	for i := range msgs {
		for _, m := range parsed[i] {
			if m.Kind != mention.KindUser {
				msgs[i].Mentions = append(msgs[i].Mentions, Mention{Kind: m.Kind})
				continue
			}
			// 存在しない ID は落とす。本文にはトークンが残るので、クライアントはそのまま文字列として出す。
			if p, ok := byID[m.UserID]; ok {
				msgs[i].Mentions = append(msgs[i].Mentions, Mention{Kind: m.Kind, User: &p})
			}
		}
	}
	return nil
}
