package chat

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat/store"
	"github.com/shun2218-dev/hibari/internal/platform/webpush"
)

// プッシュ通知の配信（ADR 0069 決定 8）。
//
// PushDelivery は既存の配信（Redis → Hub）を包む合成の Delivery で、ユースケースは何も変えない（ルール 6）。
// 送るのは、イベントを作ったインスタンスだけ。Delivery を呼ぶのはユースケース（Service）だけで、Redis で配られた先の
// インスタンスは Broker から Hub へ直接渡し、Delivery を通らない。ここに置けば、インスタンスがいくつあっても 1 回だけ送る。
//
// 送信はリクエストの処理を止めない。Deliver は上限付きの列に積んで戻り、決まった数の goroutine（Run）が送る。
// 列があふれたら捨てる。WS の配信と同じ at-most-once の扱いで、落ちても開けば未読とバッジで分かる（ADR 0004、ルール 4）。

// PushSender は通知を 1 件送る（*webpush.Sender が実装する）。テストで偽物に差し替えるためにインターフェースにする。
type PushSender interface {
	Send(ctx context.Context, sub webpush.Subscription, msg webpush.Message) error
}

// PushDispatcher はイベント 1 件分のプッシュ通知を送る（*Service が実装する）。
//
// PushDelivery が Service を直接持たないのは、Service が組み立てのときに Delivery を受け取るため（循環を作らない）。
// Run に渡すので、列と Service を別々に組み立てられる。
type PushDispatcher interface {
	SendPushes(ctx context.Context, ev Event)
}

// PushDeliveryOptions は PushDelivery の設定。
type PushDeliveryOptions struct {
	// QueueSize は積んでおけるイベントの数。超えた分は捨てる（メモリを際限なく使わず、リクエストも待たせないため）。
	QueueSize int
	// Workers は同時に送る goroutine の数。送り先が遅くても、ほかの処理の goroutine や接続を食い潰さない上限。
	Workers int
}

// DefaultPushDeliveryOptions は本番の既定。
//
// 1 件のイベントは、送る相手の判定（DB の数回の読み取り）と購読ごとの POST になる。列の 1024 は、
// 送り先がしばらく止まっても数分ぶんのメッセージを受け止められる大きさ。Workers の 4 は DB のプールを占めすぎない数。
var DefaultPushDeliveryOptions = PushDeliveryOptions{QueueSize: 1024, Workers: 4}

// PushDelivery は、inner に配信したうえで、プッシュ通知のきっかけになるイベントを列に積む Delivery。
type PushDelivery struct {
	inner   Delivery
	queue   chan Event
	workers int
	logger  *slog.Logger
	dropped atomic.Int64
}

var _ Delivery = (*PushDelivery)(nil)

// NewPushDelivery は PushDelivery を返す。送り始めるには Run を動かす。
func NewPushDelivery(inner Delivery, opts PushDeliveryOptions, logger *slog.Logger) *PushDelivery {
	if inner == nil || opts.QueueSize <= 0 || opts.Workers <= 0 {
		// 設定の組み立ての誤り。リクエストの処理では起きない。
		panic("chat: push delivery needs an inner delivery and a positive queue size and workers")
	}
	return &PushDelivery{inner: inner, queue: make(chan Event, opts.QueueSize), workers: opts.Workers, logger: logger}
}

// pushTrigger は、プッシュ通知を送りうるイベントか（決定 6）。それ以外は列に積まない（列を無駄に埋めない）。
// 送るかどうかの細かい判定（システムメッセージ・送信者・presence など）は、送る側の PushNotifications が DB を読んで行う。
func pushTrigger(t EventType) bool {
	return t == EventMessageCreated || t == EventHuddleRinging
}

// pushDropLogEvery は、捨てた数をログに出す間隔。あふれているのは過負荷のときなので、1 件ごとに書いてさらに重くしない。
const pushDropLogEvery = 100

// Deliver は inner に配信し、きっかけのイベントなら列に積んで戻る。列がいっぱいなら待たずに捨てる。
//
// inner を先に呼ぶのは、プッシュの都合で WS の配信を遅らせないため。積むのも select の default で待たない。
func (d *PushDelivery) Deliver(ctx context.Context, ev Event) {
	d.inner.Deliver(ctx, ev)
	if !pushTrigger(ev.Type) {
		return
	}
	select {
	case d.queue <- ev:
	default:
		// 中身（宛先・本文）は書かない。数だけで、あふれていることと規模は分かる
		if n := d.dropped.Add(1); n == 1 || n%pushDropLogEvery == 0 {
			d.logger.WarnContext(ctx, "push delivery: queue is full, dropped", slog.Int64("dropped_total", n))
		}
	}
}

// Dropped は、列があふれて捨てたイベントの数（起動からの累計）。
func (d *PushDelivery) Dropped() int64 { return d.dropped.Load() }

// Run は ctx が終わるまで、列のイベントを Workers 個の goroutine で dispatcher に渡す。
// 戻るのは、送っている途中のものも含めて、すべての goroutine が終わってから。列に残った分は捨てる（再起動で消える。決定 8）。
//
// ctx はサーバーが新しいリクエストを受け付けなくなった後に取り消すこと（cmd/server）。先に取り消すと、
// 停止の途中で処理を終えたリクエストの通知を、まだ動いているのに送らないことになる。
func (d *PushDelivery) Run(ctx context.Context, dispatcher PushDispatcher) {
	var wg sync.WaitGroup
	for range d.workers {
		wg.Go(func() {
			for {
				// select は準備のできた case から無作為に選ぶので、取り消された後にも次のイベントに進みうる。先に確かめる
				if ctx.Err() != nil {
					return
				}
				select {
				case <-ctx.Done():
					return
				case ev := <-d.queue:
					dispatcher.SendPushes(ctx, ev)
				}
			}
		})
	}
	wg.Wait()
}

const (
	// pushPlanTimeout は、イベント 1 件の送る相手の判定と購読の読み取りの上限。DB が詰まっても worker を占有し続けない。
	pushPlanTimeout = 10 * time.Second
	// PushSendTimeout は購読 1 つへの送信（セッションの確認・POST・消えた購読の削除）の上限。
	// 遅いプッシュのサービスに worker を取られて、ほかの人への通知まで遅れるのを抑える。送り直さないので、切れたらその通知は落ちる。
	PushSendTimeout = 10 * time.Second
)

// pushSendingEnabled は、送るのに要るもの（送信の実装とセッションの確認）がそろっているか。
func (s *Service) pushSendingEnabled() bool {
	return s.pushEnabled() && s.push.Sender != nil && s.push.Sessions != nil
}

// SendPushes は ev から決まるプッシュ通知を、受け取る人の購読ごとに送る（PushDispatcher）。
//
// 失敗はログに残すだけにする。送り直さない（at-most-once。429 や 5xx でも次の通知で届く。決定 8）。
// ログには endpoint・鍵・本文を出さない（CLAUDE.md「ログ」）。出すのは購読の ID と人の ID だけ。
func (s *Service) SendPushes(ctx context.Context, ev Event) {
	if !s.pushSendingEnabled() {
		return
	}
	targets, notifications, err := s.pushTargets(ctx, ev)
	if err != nil {
		if ctx.Err() == nil {
			s.logger.ErrorContext(ctx, "push delivery: resolve recipients failed", slog.String("event", string(ev.Type)), slog.Any("error", err))
		}
		return
	}
	for _, n := range notifications {
		for _, sub := range targets[n.UserID] {
			if ctx.Err() != nil {
				return
			}
			s.sendPush(ctx, sub, n.Message)
		}
	}
}

// pushTargets は、送る通知と、受け取る人ごとの購読を返す。購読は全員の分を 1 回のクエリで読む（N+1 にしない）。
func (s *Service) pushTargets(ctx context.Context, ev Event) (map[ulid.ULID][]store.ListPushTargetsRow, []PushNotification, error) {
	ctx, cancel := context.WithTimeout(ctx, pushPlanTimeout)
	defer cancel()
	notifications, err := s.PushNotifications(ctx, ev)
	if err != nil || len(notifications) == 0 {
		return nil, nil, err
	}
	userIDs := make([]ulid.ULID, len(notifications))
	for i, n := range notifications {
		userIDs[i] = n.UserID
	}
	rows, err := store.New(s.db).ListPushTargets(ctx, userIDs)
	if err != nil {
		return nil, nil, err
	}
	targets := make(map[ulid.ULID][]store.ListPushTargetsRow, len(notifications))
	for _, r := range rows {
		targets[r.UserID] = append(targets[r.UserID], r)
	}
	return targets, notifications, nil
}

// sendPush は購読 1 つに送る。
//
//  1. セッションがまだ有効かを確かめる。失効の知らせ（auth:revoked）は Redis Pub/Sub で取りこぼしうるので、
//     送る直前にも確かめる（ADR 0069 決定 3 の二段構え）。失効していたら購読を消し、送らない
//  2. 送る。404 / 410 なら購読が消えているので行を消す。それ以外の失敗（429・5xx・時間切れ）は送り直さない
func (s *Service) sendPush(ctx context.Context, sub store.ListPushTargetsRow, msg webpush.Message) {
	ctx, cancel := context.WithTimeout(ctx, PushSendTimeout)
	defer cancel()
	attrs := []any{slog.String("push_subscription_id", sub.ID.String()), slog.String("user_id", sub.UserID.String())}

	active, err := s.push.Sessions.SessionActive(ctx, sub.UserID, sub.Sid)
	if err != nil {
		// 確かめられないなら送らない。ログアウトした端末に本文を届けるほうが、1 件落とすより害が大きい
		if ctx.Err() == nil {
			s.logger.WarnContext(ctx, "push delivery: check session failed", append(attrs, slog.Any("error", err))...)
		}
		return
	}
	q := store.New(s.db)
	if !active {
		if err := q.DeletePushSubscriptionsForSession(ctx, sub.Sid); err != nil {
			s.logger.WarnContext(ctx, "push delivery: delete revoked subscription failed", append(attrs, slog.Any("error", err))...)
		}
		return
	}

	err = s.push.Sender.Send(ctx, webpush.Subscription{Endpoint: sub.Endpoint, P256dh: sub.P256dh, Auth: sub.Auth}, msg)
	switch {
	case err == nil:
	case errors.Is(err, webpush.ErrGone):
		// ブラウザが購読をやめた・期限が切れた。送り直しても届かない（決定 8）
		if err := q.DeleteGonePushSubscription(ctx, store.DeleteGonePushSubscriptionParams{ID: sub.ID, Endpoint: sub.Endpoint}); err != nil {
			s.logger.WarnContext(ctx, "push delivery: delete gone subscription failed", append(attrs, slog.Any("error", err))...)
		}
	default:
		// webpush のエラーは endpoint を含まない（URL を落として包んである）ので、そのまま書いてよい
		s.logger.WarnContext(ctx, "push delivery: send failed", append(attrs, slog.Any("error", err))...)
	}
}
