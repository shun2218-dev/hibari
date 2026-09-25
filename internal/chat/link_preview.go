package chat

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat/authz"
	"github.com/shun2218-dev/hibari/internal/chat/linkpreview"
	"github.com/shun2218-dev/hibari/internal/chat/store"
	"github.com/shun2218-dev/hibari/internal/platform/ratelimit"
	"github.com/shun2218-dev/hibari/internal/platform/storage"
)

// 外部のリンクのプレビュー（ADR 0065）。
//
// 送信・編集のトランザクションで、本文の URL ごとに取得待ち（pending）の行を作る。取りに行くのは常駐のジョブで、
// 取れたらメッセージの change_seq を進めて message.updated を配る（リアクションと同じ入れ方。ADR 0044）。
// 一度付いたカードは、サイト側が変わっても取り直さない（決定 1）。
//
// 取得の結果は URL ごとの行（link_previews）に置き、30 分の間は使い回す（決定 2）。
// 入力欄の API（決定 13）も同じ行を作るので、入力欄で取れていれば、送信のトランザクションで見つかってその場で付く。

const (
	// linkPreviewReuse は、同じ URL の取得の結果を使い回す時間（決定 2。Slack と同じ）。
	linkPreviewReuse = 30 * time.Minute
	// linkPreviewRetention は、どのメッセージからも指されていない結果を残す時間。
	// 使い回しの時間より十分に長くし、送信が指そうとしている行を掃除のジョブが消さないようにする。
	linkPreviewRetention = 2 * time.Hour
	// linkPreviewClaim は、取得のジョブが 1 件を取っている時間。取得の上限（10 秒）より長くする。過ぎたら拾い直す。
	linkPreviewClaim = time.Minute
	// linkPreviewMaxAttempts は取得を試みる回数の上限。ジョブが落ちて拾い直し続ける行を、いつか failed にする。
	linkPreviewMaxAttempts = 3
	// LinkPreviewInterval は、取得待ちを拾い直す間隔（決定 10）。知らせを取りこぼしたときのためで、速さは知らせで出す。
	LinkPreviewInterval = 30 * time.Second
	// linkPreviewWorkers は、取得のジョブが同時に取りに行く数（決定 8）。
	linkPreviewWorkers = 4
	// linkPreviewFetchSlots は、ジョブと入力欄の API を合わせて 1 台が同時に取りに行く数（決定 8）。
	linkPreviewFetchSlots = 8
	// linkPreviewURLMax は、入力欄の API が受け付ける URL の長さ。
	linkPreviewURLMax = 2048
)

// linkPreviewRule は入力欄の API の回数の上限（決定 13）。サーバーを任意の URL に向かわせる口なので、1 人あたりで絞る。
var linkPreviewRule = ratelimit.Rule{Name: "link-preview", Limit: 30, Window: time.Minute}

// 行の状態（db/migrations/00020_link_previews.sql の CHECK と同じ値）。
const (
	linkPreviewPending = "pending"
	linkPreviewOK      = "ok"
	linkPreviewFailed  = "failed"
)

// LinkPreviewFetcher は外部のページのプレビューを取る。本番は linkpreview.Fetcher（接続の検査は safehttp）。
type LinkPreviewFetcher interface {
	Fetch(ctx context.Context, rawURL string) (linkpreview.Preview, error)
}

// RateLimiter は回数の上限を数える（platform/ratelimit.Limiter）。
type RateLimiter interface {
	Allow(ctx context.Context, rule ratelimit.Rule, key string) (ratelimit.Decision, error)
}

// RateLimitedError は回数の上限を超えたことを表す。
type RateLimitedError struct {
	RetryAfter time.Duration
}

func (e *RateLimitedError) Error() string { return "chat: rate limited" }

// LinkPreviewDeps は外部のリンクのプレビューの依存。
type LinkPreviewDeps struct {
	Fetcher LinkPreviewFetcher
	// AppBaseURL は Web クライアントの URL。同じオリジンの URL（パーマリンク）は展開しない（決定 3）。
	AppBaseURL *url.URL
	Limiter    RateLimiter
}

// linkPreviews は Service が持つ、プレビューのための状態。
type linkPreviews struct {
	fetcher LinkPreviewFetcher
	app     *url.URL
	limiter RateLimiter
	// wake は取得のジョブを起こす。送信・編集の commit の後に、ブロックせずに送る。
	wake chan struct{}
	// slots は同時に取りに行く数を絞る（ジョブと入力欄の API で共有する）。
	slots chan struct{}
}

func newLinkPreviews(d LinkPreviewDeps) linkPreviews {
	return linkPreviews{
		fetcher: d.Fetcher,
		app:     d.AppBaseURL,
		limiter: d.Limiter,
		wake:    make(chan struct{}, linkPreviewWorkers),
		slots:   make(chan struct{}, linkPreviewFetchSlots),
	}
}

// MessageLinkPreview はメッセージに付いたプレビュー（決定 6）。見せるもの（取れていて、消していない）だけを持つ。
type MessageLinkPreview struct {
	ID ulid.ULID
	// URL は本文に書かれた URL（リダイレクトの後ではない）。
	URL         string
	SiteName    string
	Title       string
	Description string
	// Image は画像があるときだけ。URL は表示するときに LinkPreviewURLs で取る。
	Image   *LinkPreviewImage
	HasIcon bool
}

// LinkPreviewImage は画像の寸法。クライアントが読み込む前に枠を確保するのに使う。
type LinkPreviewImage struct {
	Width, Height int
}

// ---- 送信・編集・削除のトランザクションの中 ----

// createMessageLinkPreviews は、送信したメッセージの本文の URL ごとに行を作る（決定 1・3）。
// 30 分以内の結果があればその場で付け、なければ取得待ちにする。suppressed は入力欄で消した URL で、最初から消した行にする（決定 13）。
func (s *Service) createMessageLinkPreviews(ctx context.Context, q *store.Queries, roomID, messageID ulid.ULID, body string, suppressed []string) error {
	now := s.clock.Now()
	for i, u := range linkpreview.Candidates(body, s.previews.app) {
		var removedAt *time.Time
		if slices.Contains(suppressed, u) {
			removedAt = &now
		}
		if err := s.createMessageLinkPreview(ctx, q, now, roomID, messageID, u, i, removedAt); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) createMessageLinkPreview(ctx context.Context, q *store.Queries, now time.Time, roomID, messageID ulid.ULID, u string, position int, removedAt *time.Time) error {
	params := store.CreateMessageLinkPreviewParams{
		ID: s.ids.New(), RoomID: roomID, MessageID: messageID, Url: u, Position: int32(position),
		Status: linkPreviewPending, RemovedAt: removedAt, Now: now,
	}
	cached, err := q.FindFreshLinkPreview(ctx, store.FindFreshLinkPreviewParams{Url: u, Since: now.Add(-linkPreviewReuse)})
	switch {
	case err == nil && cached.Status == linkPreviewOK:
		params.Status, params.LinkPreviewID = linkPreviewOK, &cached.ID
	case err == nil:
		params.Status = linkPreviewFailed
	case !errors.Is(err, pgx.ErrNoRows):
		return fmt.Errorf("find fresh link preview: %w", err)
	}
	if err := q.CreateMessageLinkPreview(ctx, params); err != nil {
		return fmt.Errorf("create message link preview: %w", err)
	}
	return nil
}

// syncMessageLinkPreviews は、編集した本文に合わせて行を直す（決定 4）。
// 増えた URL は新しく作り、無くなった URL の行は消し、残った URL は並びだけを直す（取り直さない）。
// 本人が消した行は、URL が本文から無くなっても残す（書き戻しても出さない）。
func (s *Service) syncMessageLinkPreviews(ctx context.Context, q *store.Queries, roomID, messageID ulid.ULID, body string) error {
	urls := linkpreview.Candidates(body, s.previews.app)
	existing, err := q.ListMessageLinkPreviewURLs(ctx, messageID)
	if err != nil {
		return fmt.Errorf("list message link previews: %w", err)
	}
	if err := q.DeleteMessageLinkPreviewsExcept(ctx, store.DeleteMessageLinkPreviewsExceptParams{MessageID: messageID, Urls: urls}); err != nil {
		return fmt.Errorf("delete message link previews: %w", err)
	}
	now := s.clock.Now()
	positions := make([]int32, len(urls))
	for i, u := range urls {
		positions[i] = int32(i)
		if !slices.ContainsFunc(existing, func(r store.ListMessageLinkPreviewURLsRow) bool { return r.Url == u }) {
			if err := s.createMessageLinkPreview(ctx, q, now, roomID, messageID, u, i, nil); err != nil {
				return err
			}
		}
	}
	if err := q.UpdateMessageLinkPreviewPositions(ctx, store.UpdateMessageLinkPreviewPositionsParams{MessageID: messageID, Urls: urls, Positions: positions}); err != nil {
		return fmt.Errorf("update link preview positions: %w", err)
	}
	return nil
}

// wakeLinkPreviews は、本文に展開する URL があれば取得のジョブを起こす。commit の後に呼ぶ。ブロックしない。
func (s *Service) wakeLinkPreviews(body string) {
	if len(linkpreview.Candidates(body, s.previews.app)) == 0 {
		return
	}
	for range linkPreviewWorkers {
		select {
		case s.previews.wake <- struct{}{}:
		default:
		}
	}
}

// loadMessageLinkPreviews は msgs に LinkPreviews を載せる。ページの全メッセージを 1 回のクエリで読む（N+1 にしない）。
func loadMessageLinkPreviews(ctx context.Context, q *store.Queries, roomID ulid.ULID, msgs []Message) error {
	if len(msgs) == 0 {
		return nil
	}
	ids := make([]ulid.ULID, len(msgs))
	index := make(map[ulid.ULID]int, len(msgs))
	for i := range msgs {
		msgs[i].LinkPreviews = []MessageLinkPreview{}
		ids[i] = msgs[i].ID
		index[msgs[i].ID] = i
	}
	rows, err := q.ListMessageLinkPreviews(ctx, store.ListMessageLinkPreviewsParams{RoomID: roomID, MessageIds: ids})
	if err != nil {
		return fmt.Errorf("list message link previews: %w", err)
	}
	for _, r := range rows {
		i, ok := index[r.MessageID]
		// 削除済みのメッセージは行を消しているが、念のため跡を残さない（ADR 0038）
		if !ok || msgs[i].DeletedAt != nil {
			continue
		}
		p := MessageLinkPreview{ID: r.ID, URL: r.Url, SiteName: r.SiteName, Title: r.Title, Description: r.Description, HasIcon: r.HasIcon}
		if r.ImageWidth != nil && r.ImageHeight != nil {
			p.Image = &LinkPreviewImage{Width: int(*r.ImageWidth), Height: int(*r.ImageHeight)}
		}
		msgs[i].LinkPreviews = append(msgs[i].LinkPreviews, p)
	}
	return nil
}

// ---- 取得（ジョブと入力欄の API で共通）----

// resolveLinkPreview は URL の取得の結果を返す。30 分以内の結果があればそれを使い、なければ取りに行って行を作る。
// 同時に取りに行く数の上限に達していれば、取りに行かずに ok を false で返す（入力欄の API は待たずに「カードなし」にする）。
func (s *Service) resolveLinkPreview(ctx context.Context, u string, wait bool) (store.LinkPreview, bool, error) {
	now := s.clock.Now()
	cached, err := store.New(s.db).FindFreshLinkPreview(ctx, store.FindFreshLinkPreviewParams{Url: u, Since: now.Add(-linkPreviewReuse)})
	switch {
	case err == nil:
		return cached, true, nil
	case !errors.Is(err, pgx.ErrNoRows):
		return store.LinkPreview{}, false, fmt.Errorf("find fresh link preview: %w", err)
	}

	if wait {
		select {
		case s.previews.slots <- struct{}{}:
		case <-ctx.Done():
			return store.LinkPreview{}, false, ctx.Err()
		}
	} else {
		select {
		case s.previews.slots <- struct{}{}:
		default:
			return store.LinkPreview{}, false, nil
		}
	}
	defer func() { <-s.previews.slots }()

	lp := store.CreateLinkPreviewParams{ID: s.ids.New(), Url: u, Status: linkPreviewFailed}
	p, fetchErr := s.previews.fetcher.Fetch(ctx, u)
	var fe *linkpreview.FetchError
	switch {
	case fetchErr == nil:
		lp.Status, lp.Title, lp.Description, lp.SiteName = linkPreviewOK, p.Title, p.Description, p.SiteName
		keys, err := s.storeLinkPreviewImages(ctx, &lp, p)
		defer func() {
			// 行を作れなかったら、置いたオブジェクトを消す（作れていれば keys は空にしてある）
			for _, k := range keys {
				_ = s.storage.Delete(context.WithoutCancel(ctx), k)
			}
		}()
		if err != nil {
			return store.LinkPreview{}, false, err
		}
		lp.FetchedAt = s.clock.Now()
		if err := store.New(s.db).CreateLinkPreview(ctx, lp); err != nil {
			return store.LinkPreview{}, false, fmt.Errorf("create link preview: %w", err)
		}
		keys = nil
	case errors.As(fetchErr, &fe):
		// URL もホスト名もログに出さない（決定 11）。種類だけを残す
		s.logger.InfoContext(ctx, "link preview not available", slog.String("link_preview_id", lp.ID.String()), slog.String("reason", string(fe.Kind)))
		lp.FetchedAt = s.clock.Now()
		if err := store.New(s.db).CreateLinkPreview(ctx, lp); err != nil {
			return store.LinkPreview{}, false, fmt.Errorf("create link preview: %w", err)
		}
	default:
		return store.LinkPreview{}, false, fmt.Errorf("fetch link preview: %w", fetchErr)
	}
	return linkPreviewRow(lp), true, nil
}

// storeLinkPreviewImages は画像とアイコンをストレージに置き、lp にキーを入れる。置いたキーを返す。
func (s *Service) storeLinkPreviewImages(ctx context.Context, lp *store.CreateLinkPreviewParams, p linkpreview.Preview) ([]string, error) {
	var keys []string
	put := func(img *linkpreview.Image) (*string, error) {
		// キーに URL もファイル名も入れない（決定 7）
		key := "link-previews/" + s.ids.New().String()
		if err := s.storage.Put(ctx, key, img.ContentType, img.Data); err != nil {
			return nil, fmt.Errorf("put link preview image: %w", err)
		}
		keys = append(keys, key)
		return &key, nil
	}
	if p.Image != nil {
		key, err := put(p.Image)
		if err != nil {
			return keys, err
		}
		w, h := int32(p.Image.Width), int32(p.Image.Height)
		lp.ImageObjectKey, lp.ImageContentType, lp.ImageWidth, lp.ImageHeight = key, &p.Image.ContentType, &w, &h
	}
	if p.Icon != nil {
		key, err := put(p.Icon)
		if err != nil {
			return keys, err
		}
		lp.IconObjectKey, lp.IconContentType = key, &p.Icon.ContentType
	}
	return keys, nil
}

func linkPreviewRow(p store.CreateLinkPreviewParams) store.LinkPreview {
	// 列が同じなので、そのまま変換できる（sqlc の生成したクエリの引数と行の型）
	return store.LinkPreview(p)
}

// ---- 取得のジョブ（決定 10）----

// RunLinkPreviews は取得のジョブを ctx が終わるまで動かす。知らせ（送信・編集の commit の後）と interval ごとに、取得待ちを拾う。
// 戻るのは、取りに行っている途中のものも含めて、すべての goroutine が終わってから。
func (s *Service) RunLinkPreviews(ctx context.Context, interval time.Duration) {
	var wg sync.WaitGroup
	for range linkPreviewWorkers {
		wg.Go(func() {
			ticker := time.NewTicker(interval)
			defer ticker.Stop()
			for {
				s.ProcessLinkPreviews(ctx, nil)
				select {
				case <-ctx.Done():
					return
				case <-s.previews.wake:
				case <-ticker.C:
				}
			}
		})
	}
	wg.Wait()
}

// ProcessLinkPreviews は、取得待ちがなくなるまで 1 件ずつ取りに行き、処理した件数を返す。
// roomID を渡すと、そのルームの行だけを処理する。テストだけが使う（テスト用 DB を共有するほかのテストの行を取らないため）。
// 本番のジョブ（RunLinkPreviews）は nil を渡す。
func (s *Service) ProcessLinkPreviews(ctx context.Context, roomID *ulid.ULID) int {
	n := 0
	for s.processLinkPreview(ctx, roomID) {
		n++
	}
	return n
}

// processLinkPreview は取得待ちを 1 件処理する。処理するものがなければ（エラーのときも）false。
func (s *Service) processLinkPreview(ctx context.Context, roomID *ulid.ULID) bool {
	if ctx.Err() != nil {
		return false
	}
	now := s.clock.Now()
	claimed, err := store.New(s.db).ClaimPendingMessageLinkPreview(ctx, store.ClaimPendingMessageLinkPreviewParams{
		ClaimedUntil: now.Add(linkPreviewClaim), Now: now, RoomID: roomID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return false
	}
	if err != nil {
		s.logger.ErrorContext(ctx, "claim link preview", slog.Any("error", err))
		return false
	}

	status, linkID := linkPreviewFailed, (*ulid.ULID)(nil)
	if claimed.Attempts <= linkPreviewMaxAttempts {
		lp, ok, err := s.resolveLinkPreview(ctx, claimed.Url, true)
		if err != nil {
			// ストレージや DB が落ちている。行は claimed_until が過ぎたら拾い直す
			if ctx.Err() == nil {
				s.logger.ErrorContext(ctx, "resolve link preview", slog.String("message_link_preview_id", claimed.ID.String()), slog.Any("error", err))
			}
			return false
		}
		if ok && lp.Status == linkPreviewOK {
			status, linkID = linkPreviewOK, &lp.ID
		}
	}
	if err := s.completeLinkPreview(ctx, claimed.RoomID, claimed.MessageID, claimed.ID, status, linkID); err != nil {
		s.logger.ErrorContext(ctx, "complete link preview", slog.String("message_link_preview_id", claimed.ID.String()), slog.Any("error", err))
	}
	return true
}

// completeLinkPreview は取得の結果を行に書く。取れたら change_seq を進めて message.updated を配る。
// 取得の間に編集で URL が消えた・本人が消した・メッセージが削除されたなら、何もしない。
func (s *Service) completeLinkPreview(ctx context.Context, roomID, messageID, id ulid.ULID, status string, linkID *ulid.ULID) error {
	var (
		msg     Message
		changed bool
	)
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		q := store.New(tx)
		// 編集と同じく、メッセージの行 → プレビューの行 → rooms（change_seq の採番）の順にロックする（ADR 0014）
		m, err := q.GetMessageForUpdate(ctx, store.GetMessageForUpdateParams{RoomID: roomID, ID: messageID})
		if errors.Is(err, pgx.ErrNoRows) {
			return nil // ルームごと消えた
		}
		if err != nil {
			return fmt.Errorf("lock message: %w", err)
		}
		row, err := q.GetMessageLinkPreviewForUpdate(ctx, store.GetMessageLinkPreviewForUpdateParams{ID: id, MessageID: messageID})
		if errors.Is(err, pgx.ErrNoRows) {
			return nil // 編集で URL が消えた
		}
		if err != nil {
			return fmt.Errorf("lock message link preview: %w", err)
		}
		if row.Status != linkPreviewPending || m.DeletedAt != nil {
			return nil
		}
		if status == linkPreviewOK && row.RemovedAt == nil {
			changeSeq, err := q.AllocateChangeSeq(ctx, store.AllocateChangeSeqParams{RoomID: roomID, N: 1})
			if errors.Is(err, pgx.ErrNoRows) {
				// その間にアーカイブされた。読むだけのルームの表示は変えない（ADR 0059 決定 3）
				status, linkID = linkPreviewFailed, nil
			} else if err != nil {
				return fmt.Errorf("allocate change_seq: %w", err)
			} else {
				// edited_at は触らない。プレビューが付くのは「編集」ではない（リアクションと同じ）
				if err := q.UpdateMessageChangeSeq(ctx, store.UpdateMessageChangeSeqParams{ID: messageID, ChangeSeq: changeSeq}); err != nil {
					return fmt.Errorf("update change_seq: %w", err)
				}
				changed = true
			}
		}
		if err := q.CompleteMessageLinkPreview(ctx, store.CompleteMessageLinkPreviewParams{Status: status, LinkPreviewID: linkID, ID: id}); err != nil {
			return fmt.Errorf("complete message link preview: %w", err)
		}
		if changed {
			// viewer は配信の JSON に効かない（Me や Saved は httpx が落とす）ので、送信者を渡す
			msg, err = getMessage(ctx, q, roomID, m.SenderID, messageID)
		}
		return err
	})
	if err != nil {
		return err
	}
	if changed {
		s.deliver(ctx, messageEvent(EventMessageUpdated, msg))
	}
	return nil
}

// CleanupLinkPreviews は、どのメッセージからも指されていない古い取得の結果を消し、画像とアイコンのキーを
// ストレージの掃除の列（storage_deletions。ADR 0059）に積む。オブジェクトを消すのは添付の掃除ジョブ。
func (s *Service) CleanupLinkPreviews(ctx context.Context) (int, error) {
	total := 0
	for {
		var n int
		err := s.inTx(ctx, func(tx pgx.Tx) error {
			q := store.New(tx)
			now := s.clock.Now()
			rows, err := q.LockUnreferencedLinkPreviews(ctx, store.LockUnreferencedLinkPreviewsParams{Before: now.Add(-linkPreviewRetention), MaxRows: cleanupBatchSize})
			if err != nil {
				return fmt.Errorf("lock unreferenced link previews: %w", err)
			}
			if len(rows) == 0 {
				return nil
			}
			ids := make([]ulid.ULID, len(rows))
			var keys []string
			for i, r := range rows {
				ids[i] = r.ID
				for _, k := range []*string{r.ImageObjectKey, r.IconObjectKey} {
					if k != nil {
						keys = append(keys, *k)
					}
				}
			}
			if len(keys) > 0 {
				// 発行済みの GET URL（5 分）が切れるまでは消さない
				if err := q.EnqueueStorageDeletions(ctx, store.EnqueueStorageDeletionsParams{ObjectKeys: keys, NotBefore: now.Add(downloadURLTTL), Now: now}); err != nil {
					return fmt.Errorf("enqueue storage deletions: %w", err)
				}
			}
			if err := q.DeleteLinkPreviews(ctx, ids); err != nil {
				return fmt.Errorf("delete link previews: %w", err)
			}
			n = len(rows)
			return nil
		})
		total += n
		if err != nil || n < cleanupBatchSize {
			return total, err
		}
	}
}

// ---- API ----

// ComposerLinkPreview は入力欄のプレビュー（決定 13）。画像とアイコンの署名付き URL を直接持つ。
type ComposerLinkPreview struct {
	URL         string
	SiteName    string
	Title       string
	Description string
	Image       *ComposerLinkPreviewImage
	Icon        *SignedURL
}

// ComposerLinkPreviewImage は入力欄のプレビューの画像。
type ComposerLinkPreviewImage struct {
	Width, Height int
	SignedURL
}

// SignedURL は署名付きの GET URL と期限。
type SignedURL struct {
	URL       string
	ExpiresAt time.Time
}

// PreviewLink は入力欄のプレビューを取る（決定 13）。カードにならなければ nil（理由は区別しない）。
//
// そのルームに投稿できる人だけが呼べる。ログインしているだけの人に、サーバーを任意の URL へ向かわせる口を開けないため。
func (s *Service) PreviewLink(ctx context.Context, actor, roomID ulid.ULID, rawURL string) (*ComposerLinkPreview, error) {
	u, err := url.Parse(rawURL)
	if len(rawURL) > linkPreviewURLMax || err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		var fields fieldErrors
		fields.add("url", ReasonInvalidFormat)
		return nil, fields.err()
	}
	a, err := loadRoomAccess(ctx, store.New(s.db), noLock, roomID, actor)
	if err != nil {
		return nil, err
	}
	if !authz.CanReadRoom(a.authzRoom(), a.actor(actor)) {
		return nil, ErrNotFound
	}
	if err := a.authorize(func(r authz.Room) bool { return authz.CanWriteRoom(r, a.actor(actor)) }); err != nil {
		return nil, err
	}
	if s.previews.limiter != nil {
		d, err := s.previews.limiter.Allow(ctx, linkPreviewRule, actor.String())
		if err != nil {
			return nil, err
		}
		if !d.Allowed {
			return nil, &RateLimitedError{RetryAfter: d.RetryAfter}
		}
	}
	// 本文と同じく、自分のアプリの URL（パーマリンク）は展開しない（決定 3）
	if linkpreview.IsAppURL(u, s.previews.app) {
		return nil, nil
	}

	lp, ok, err := s.resolveLinkPreview(ctx, rawURL, false)
	if err != nil || !ok || lp.Status != linkPreviewOK {
		return nil, err
	}
	out := &ComposerLinkPreview{URL: rawURL, SiteName: lp.SiteName, Title: lp.Title, Description: lp.Description}
	if lp.ImageObjectKey != nil && lp.ImageWidth != nil && lp.ImageHeight != nil {
		signed, err := s.signLinkPreviewObject(ctx, *lp.ImageObjectKey, lp.ImageContentType)
		if err != nil {
			return nil, err
		}
		out.Image = &ComposerLinkPreviewImage{Width: int(*lp.ImageWidth), Height: int(*lp.ImageHeight), SignedURL: signed}
	}
	if lp.IconObjectKey != nil {
		signed, err := s.signLinkPreviewObject(ctx, *lp.IconObjectKey, lp.IconContentType)
		if err != nil {
			return nil, err
		}
		out.Icon = &signed
	}
	return out, nil
}

// LinkPreviewURLs は、メッセージに付いたプレビューの画像とアイコンの署名付き URL を返す（決定 7）。
// 貼られた URL そのものが private ルームや DM の中身なので、読めるルームのものだけ。ないものは nil。
func (s *Service) LinkPreviewURLs(ctx context.Context, actor, roomID, messageID, previewID ulid.ULID) (image, icon *SignedURL, err error) {
	q := store.New(s.db)
	a, err := loadRoomAccess(ctx, q, noLock, roomID, actor)
	if err != nil {
		return nil, nil, err
	}
	if !authz.CanReadRoom(a.authzRoom(), a.actor(actor)) {
		return nil, nil, ErrNotFound
	}
	objs, err := q.GetMessageLinkPreviewObjects(ctx, store.GetMessageLinkPreviewObjectsParams{RoomID: roomID, MessageID: messageID, ID: previewID})
	if err != nil {
		return nil, nil, notFoundIfNoRows(err, "get link preview objects")
	}
	if objs.ImageObjectKey != nil {
		signed, err := s.signLinkPreviewObject(ctx, *objs.ImageObjectKey, objs.ImageContentType)
		if err != nil {
			return nil, nil, err
		}
		image = &signed
	}
	if objs.IconObjectKey != nil {
		signed, err := s.signLinkPreviewObject(ctx, *objs.IconObjectKey, objs.IconContentType)
		if err != nil {
			return nil, nil, err
		}
		icon = &signed
	}
	return image, icon, nil
}

func (s *Service) signLinkPreviewObject(ctx context.Context, key string, contentType *string) (SignedURL, error) {
	opts := storage.GetOptions{ContentDisposition: "inline"}
	if contentType != nil {
		opts.ContentType = *contentType
	}
	u, err := s.storage.PresignGet(ctx, key, downloadURLTTL, opts)
	if err != nil {
		return SignedURL{}, fmt.Errorf("presign link preview object: %w", err)
	}
	return SignedURL{URL: u, ExpiresAt: s.clock.Now().Add(downloadURLTTL)}, nil
}

// RemoveLinkPreview は、投稿した本人がプレビューを消す（決定 5）。確認はしない。消してあっても成功する（冪等）。
func (s *Service) RemoveLinkPreview(ctx context.Context, actor, roomID, messageID, previewID ulid.ULID) error {
	var (
		msg     Message
		changed bool
	)
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		q := store.New(tx)
		a, err := loadRoomAccess(ctx, q, memberRowLock, roomID, actor)
		if err != nil {
			return err
		}
		if !authz.CanReadRoom(a.authzRoom(), a.actor(actor)) {
			return ErrNotFound
		}
		m, err := q.GetMessageForUpdate(ctx, store.GetMessageForUpdateParams{RoomID: roomID, ID: messageID})
		if err != nil {
			return notFoundIfNoRows(err, "lock message")
		}
		if m.DeletedAt != nil || MessageKind(m.Kind) == MessageKindSystem {
			return ErrNotFound
		}
		// 消せるのは本人だけ。判定は編集と同じ（本人で、書けるルーム）
		if err := a.authorize(func(r authz.Room) bool { return authz.CanEditMessage(r, a.actor(actor), m.SenderID == actor) }); err != nil {
			return err
		}
		row, err := q.GetMessageLinkPreviewForUpdate(ctx, store.GetMessageLinkPreviewForUpdateParams{ID: previewID, MessageID: messageID})
		if err != nil {
			return notFoundIfNoRows(err, "lock message link preview")
		}
		if row.RemovedAt != nil {
			return nil
		}
		if err := q.RemoveMessageLinkPreview(ctx, store.RemoveMessageLinkPreviewParams{ID: previewID, Now: s.clock.Now()}); err != nil {
			return fmt.Errorf("remove message link preview: %w", err)
		}
		// 見えていたカードだけが、ほかの人の画面から消える。取得待ちのものは誰にも見えていないので、番号を使わない
		if row.Status != linkPreviewOK {
			return nil
		}
		changeSeq, err := q.AllocateChangeSeq(ctx, store.AllocateChangeSeqParams{RoomID: roomID, N: 1})
		if err != nil {
			return archivedIfNoRows(err, "allocate change_seq")
		}
		if err := q.UpdateMessageChangeSeq(ctx, store.UpdateMessageChangeSeqParams{ID: messageID, ChangeSeq: changeSeq}); err != nil {
			return fmt.Errorf("update change_seq: %w", err)
		}
		changed = true
		msg, err = getMessage(ctx, q, roomID, actor, messageID)
		return err
	})
	if err != nil {
		return err
	}
	if changed {
		s.deliver(ctx, messageEvent(EventMessageUpdated, msg))
	}
	return nil
}

// validateSuppressedLinkPreviewURLs は送信の suppressed_link_preview_urls を検証する（決定 13）。
func validateSuppressedLinkPreviewURLs(fields *fieldErrors, urls []string) {
	if len(urls) > linkpreview.MaxLinks {
		fields.add("suppressed_link_preview_urls", ReasonTooMany)
		return
	}
	for _, u := range urls {
		if len(u) > linkPreviewURLMax || !strings.HasPrefix(u, "http") {
			fields.add("suppressed_link_preview_urls", ReasonInvalidFormat)
			return
		}
	}
}
