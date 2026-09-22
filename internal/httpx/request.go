package httpx

import (
	"net/http"
	"strconv"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat"
	"github.com/shun2218-dev/hibari/internal/platform/authn"
)

// リクエストから値を取り出す、chat のハンドラで共通の処理。

// actorOf は認証済みのリクエストの主体を返す。requireAuth の内側でだけ呼ぶ。
func actorOf(r *http.Request) ulid.ULID {
	id, _ := authn.FromContext(r.Context())
	return id.UserID
}

// pathID はパスの ID を読む。ULID として読めなければ、存在しない ID と同じく 404 にする。
// 400 にすると「形式は正しいが存在しない ID」と区別できてしまうが、それで得られる情報はないので、クライアントの分岐を減らす方を選ぶ。
func pathID(r *http.Request, name string) (ulid.ULID, error) {
	id, err := ulid.ParseStrict(r.PathValue(name))
	if err != nil {
		return ulid.ULID{}, chat.ErrNotFound
	}
	return id, nil
}

// pageRequest はクエリ文字列の after と limit を読む。
func pageRequest(r *http.Request) (chat.PageRequest, error) {
	var p chat.PageRequest
	q := r.URL.Query()
	if s := q.Get("after"); s != "" {
		after, err := ulid.ParseStrict(s)
		if err != nil {
			return p, &errBadRequest{status: http.StatusBadRequest, detail: "after must be an ID"}
		}
		p.After = after
	}
	if s := q.Get("limit"); s != "" {
		limit, err := strconv.Atoi(s)
		if err != nil || limit < 1 {
			return p, &errBadRequest{status: http.StatusBadRequest, detail: "limit must be a positive integer"}
		}
		// 上限を超えた値は chat.PageRequest が切り詰める。
		p.Limit = limit
	}
	return p, nil
}

func nextCursor(c *ulid.ULID) *string {
	if c == nil {
		return nil
	}
	s := c.String()
	return &s
}

// bodyUserID はリクエストボディの user_id を読む。
func bodyUserID(s string) (ulid.ULID, error) {
	if s == "" {
		return ulid.ULID{}, &chat.ValidationError{Fields: []chat.FieldError{{Field: "user_id", Reason: chat.ReasonRequired}}}
	}
	id, err := ulid.ParseStrict(s)
	if err != nil {
		return ulid.ULID{}, &chat.ValidationError{Fields: []chat.FieldError{{Field: "user_id", Reason: chat.ReasonInvalidFormat}}}
	}
	return id, nil
}
