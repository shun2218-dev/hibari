package chat

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/oklog/ulid/v2"
	"golang.org/x/text/unicode/norm"

	"github.com/shun2218-dev/hibari/internal/chat/authz"
	"github.com/shun2218-dev/hibari/internal/chat/store"
)

// メッセージの検索（ADR 0061）。
//
// 認可は SQL の `readable_rooms` に集める（決定 3）。ここでは「ワークスペースのメンバーか」だけを見て、
// ルームごとの判定はクエリに任せる（1 件ずつ判定すると N+1 になる）。
//
// 並びは新しい順だけ、総件数は返さない（決定 4）。WebSocket のイベントも作らない（決定 8）。

const (
	// MaxSearchTerms は本文の条件に使える語の数（決定 6）。肯定と除外を合わせた数。
	MaxSearchTerms = 8
	// MaxSearchQueryLen は本文の条件の長さ（決定 6）。
	MaxSearchQueryLen = 200

	defaultSearchLimit = 20
	maxSearchLimit     = 50
)

// SearchQuery は検索の条件。修飾子（`in:` `from:` `before:`）はクライアントが解釈して
// ID と日時にしてから渡す（決定 5）。`Text` に残るのは本文の条件だけ。
type SearchQuery struct {
	Text             string
	RoomIDs          []ulid.ULID
	ExcludeRoomIDs   []ulid.ULID
	SenderIDs        []ulid.ULID
	ExcludeSenderIDs []ulid.ULID
	After            *time.Time
	Before           *time.Time
	Limit            int
	// Cursor は前のページの末尾。空なら最初のページ。
	Cursor string
}

// SearchResult は検索結果の 1 件（決定 7）。
//
// タイムラインの Message とは別の、意図的に小さい形にする（LinkedMessage と同じ考え方）。
// リアクション・ピン留め・「後で」・既読は持たない。結果の行をタイムラインの行として使い回せないようにして、
// 「結果は要求した時点のもので、あとから追従しない」を型で守る。
type SearchResult struct {
	ID     ulid.ULID
	RoomID ulid.ULID
	Seq    int64
	Room   LinkedRoom
	Sender UserProfile
	Body   string
	// ThreadRootID はスレッドの返信なら親。押したらスレッドを開く。
	ThreadRootID    *ulid.ULID
	CreatedAt       time.Time
	EditedAt        *time.Time
	AttachmentCount int64
}

// SearchPage は結果の 1 ページ。総件数は持たない（決定 4）。
type SearchPage struct {
	Results []SearchResult
	// NextCursor は次のページの位置。空なら終わり。
	NextCursor string
	// Terms は本文に当たった語。クライアントはこれを本文の上に重ねて塗る（決定 7）。
	// `Text` の解釈（引用符・除外）はここでしか行わないので、塗る語もサーバーが返す。
	Terms []string
}

// SearchMessages は読める範囲のメッセージを、新しい順に 1 ページ返す。
func (s *Service) SearchMessages(ctx context.Context, actor, workspaceID ulid.ULID, sq SearchQuery) (SearchPage, error) {
	terms, excluded, err := parseSearchText(sq.Text)
	if err != nil {
		return SearchPage{}, err
	}
	var fields fieldErrors
	if sq.Limit < 0 || sq.Limit > maxSearchLimit {
		fields.add("limit", ReasonInvalidValue)
	}
	if sq.After != nil && sq.Before != nil && !sq.After.Before(*sq.Before) {
		fields.add("after", ReasonInvalidValue)
	}
	if err := fields.err(); err != nil {
		return SearchPage{}, err
	}
	cursor, err := parseSearchCursor(sq.Cursor)
	if err != nil {
		var f fieldErrors
		f.add("cursor", ReasonInvalidValue)
		return SearchPage{}, f.err()
	}
	limit := sq.Limit
	if limit == 0 {
		limit = defaultSearchLimit
	}

	q := store.New(s.db)
	// ワークスペースのメンバーでなければ 404（`authz.CanReadRoom` の最初の条件）。
	// ルームごとの判定はクエリの `readable_rooms` が行う。
	if _, err := q.GetWorkspaceMember(ctx, store.GetWorkspaceMemberParams{WorkspaceID: workspaceID, UserID: actor}); err != nil {
		return SearchPage{}, notFoundIfNoRows(err, "get workspace member")
	}

	// 索引を引く語は 1 つだけ（決定 6 と search.sql の説明）。長い語ほど 2-gram のキーが多く、絞り込みが効く。
	driver, rest := splitDriverTerm(terms)
	rows, err := q.SearchMessages(ctx, store.SearchMessagesParams{
		UserID: actor, WorkspaceID: workspaceID,
		Term:             likePattern(driver),
		MoreTerms:        likePatterns(rest),
		ExcludeTerms:     likePatterns(excluded),
		RoomIds:          emptyToNil(sq.RoomIDs),
		ExcludeRoomIds:   emptyToNil(sq.ExcludeRoomIDs),
		SenderIds:        emptyToNil(sq.SenderIDs),
		ExcludeSenderIds: emptyToNil(sq.ExcludeSenderIDs),
		After:            sq.After,
		Before:           sq.Before,
		BeforeAt:         cursor.at,
		BeforeID:         cursor.id,
		MaxRows:          int32(limit + 1),
	})
	if err != nil {
		return SearchPage{}, fmt.Errorf("search messages: %w", err)
	}

	page := SearchPage{Terms: terms}
	if len(rows) > limit {
		rows = rows[:limit]
		last := rows[len(rows)-1]
		page.NextCursor = searchCursor{at: last.CreatedAt, id: last.ID}.String()
	}
	page.Results = make([]SearchResult, len(rows))
	rooms := make([]Room, 0, len(rows))
	dmKeys := make([]*string, 0, len(rows))
	// 同じルームの相手は 1 回だけ引く（N+1 にしない）。attachDMPeers はルームの並びに合わせて書き戻す
	roomAt := map[ulid.ULID]int{}
	for i, r := range rows {
		page.Results[i] = SearchResult{
			ID: r.ID, RoomID: r.RoomID, Seq: r.Seq,
			Room:            LinkedRoom{ID: r.RoomID, Kind: RoomKind(r.RoomKind), Name: derefString(r.RoomName)},
			Sender:          UserProfile{ID: r.SenderID, Handle: r.SenderHandle, DisplayName: r.SenderDisplayName},
			Body:            r.Body,
			ThreadRootID:    r.ThreadRootID,
			CreatedAt:       r.CreatedAt,
			EditedAt:        r.EditedAt,
			AttachmentCount: r.AttachmentCount,
		}
		if RoomKind(r.RoomKind) != authz.RoomDM {
			continue
		}
		if _, seen := roomAt[r.RoomID]; !seen {
			roomAt[r.RoomID] = len(rooms)
			rooms = append(rooms, Room{ID: r.RoomID, Kind: authz.RoomDM})
			dmKeys = append(dmKeys, r.RoomDmKey)
		}
	}
	if len(rooms) > 0 {
		// dm にはルーム名がないので、相手のプロフィールをまとめて引く（message_link.go と同じ）。
		if err := attachDMPeers(ctx, q, actor, rooms, dmKeys); err != nil {
			return SearchPage{}, err
		}
		for i := range page.Results {
			if at, ok := roomAt[page.Results[i].RoomID]; ok {
				page.Results[i].Room.DMPeer = rooms[at].DMPeer
			}
		}
	}
	return page, nil
}

// searchCursor は結果の位置。並びの (created_at, id) をそのまま持つ（決定 4）。
type searchCursor struct {
	at time.Time
	id ulid.ULID
}

// maxSearchTime はどのメッセージよりも後ろの時刻（最初のページの位置）。
var maxSearchTime = time.Date(9999, 12, 31, 0, 0, 0, 0, time.UTC)

func (c searchCursor) String() string {
	return base64.RawURLEncoding.EncodeToString([]byte(c.at.UTC().Format(time.RFC3339Nano) + "\n" + c.id.String()))
}

// parseSearchCursor は不透明なカーソルを読む。空なら最初のページの位置を返す。
func parseSearchCursor(s string) (searchCursor, error) {
	if s == "" {
		return searchCursor{at: maxSearchTime, id: maxULID}, nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return searchCursor{}, fmt.Errorf("decode search cursor: %w", err)
	}
	at, id, ok := strings.Cut(string(raw), "\n")
	if !ok {
		return searchCursor{}, errors.New("malformed search cursor")
	}
	t, err := time.Parse(time.RFC3339Nano, at)
	if err != nil {
		return searchCursor{}, fmt.Errorf("parse search cursor: %w", err)
	}
	u, err := ulid.Parse(id)
	if err != nil {
		return searchCursor{}, fmt.Errorf("parse search cursor id: %w", err)
	}
	return searchCursor{at: t, id: u}, nil
}

// parseSearchText は本文の条件を語に分ける（決定 6）。
//
//   - 空白（全角も）で区切る
//   - `"..."` は中身をそのまま 1 つの語にする（フレーズ）
//   - 先頭の `-` はその語を含むものを除く（`-"..."` も同じ）
//
// 肯定の語が 1 つもなければ 422 にする。除外だけでは索引を引けず、全件を走査することになるため。
func parseSearchText(text string) (terms, excluded []string, err error) {
	var fields fieldErrors
	if utf8.RuneCountInString(text) > MaxSearchQueryLen {
		fields.add("q", ReasonTooLong)
		return nil, nil, fields.err()
	}
	for _, tok := range splitSearchTokens(text) {
		exclude := strings.HasPrefix(tok, "-")
		tok = strings.TrimPrefix(tok, "-")
		tok = unquote(tok)
		if tok == "" {
			continue
		}
		if exclude {
			excluded = append(excluded, tok)
		} else {
			terms = append(terms, tok)
		}
	}
	switch {
	case len(terms) == 0:
		// 空っぽの検索も、除外だけの検索も、探すものがない
		fields.add("q", ReasonRequired)
	case len(terms)+len(excluded) > MaxSearchTerms:
		fields.add("q", ReasonTooLong)
	}
	if err := fields.err(); err != nil {
		return nil, nil, err
	}
	return terms, excluded, nil
}

// splitSearchTokens は空白で区切る。ただし `"` の中の空白では切らない。
func splitSearchTokens(text string) []string {
	var (
		tokens []string
		cur    strings.Builder
		quoted bool
	)
	flush := func() {
		if cur.Len() > 0 {
			tokens = append(tokens, cur.String())
			cur.Reset()
		}
	}
	for _, r := range text {
		switch {
		case r == '"':
			quoted = !quoted
			cur.WriteRune(r)
		case !quoted && unicode.IsSpace(r):
			flush()
		default:
			cur.WriteRune(r)
		}
	}
	flush()
	return tokens
}

// unquote は語を囲む `"` を外す。閉じていない `"` も外す（打っている途中で送られても、そのまま探せるように）。
func unquote(tok string) string {
	return strings.TrimSuffix(strings.TrimPrefix(tok, `"`), `"`)
}

// splitDriverTerm は索引を引く語（いちばん長いもの）と、残りに分ける。
// 長い語のほうが 2-gram のキーが多く、索引での絞り込みが効く。
func splitDriverTerm(terms []string) (driver string, rest []string) {
	at := 0
	for i, t := range terms {
		if utf8.RuneCountInString(t) > utf8.RuneCountInString(terms[at]) {
			at = i
		}
	}
	rest = slices.Concat(terms[:at], terms[at+1:])
	return terms[at], rest
}

// likePattern は検索語を LIKE のパターンにする（決定 6）。
//
// **正規化 → エスケープ → 前後に `%` の順で行う。** 順番を変えると壊れる:
// 全角の `％` は NFKC で `%` になるので、先にエスケープすると素通りしてワイルドカードになってしまう。
//
// 正規化は索引の式（`lower(normalize(body, NFKC))`）と同じにする。Go の `strings.ToLower` と
// Postgres の `lower()` は、ASCII と日本語では同じ結果になる（トルコ語の I など一部の文字では差がありうる）。
func likePattern(term string) string {
	n := strings.ToLower(norm.NFKC.String(term))
	return "%" + likeEscaper.Replace(n) + "%"
}

// likeEscaper は LIKE のワイルドカードを打ち消す。`\` を先に置き換えると二重に効いてしまうので、
// Replacer に 3 組まとめて渡す（Replacer は 1 回の走査で置き換える）。
var likeEscaper = strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)

func likePatterns(terms []string) []string {
	if len(terms) == 0 {
		return nil
	}
	out := make([]string, len(terms))
	for i, t := range terms {
		out[i] = likePattern(t)
	}
	return out
}

// emptyToNil は空のスライスを nil にする。クエリ側は NULL を「条件なし」として扱う。
func emptyToNil[T any](s []T) []T {
	if len(s) == 0 {
		return nil
	}
	return s
}

func derefString(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
