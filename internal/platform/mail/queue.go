package mail

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sync/atomic"
	"time"
)

// ErrQueueFull は、キューがいっぱいでメールを積めなかったことを表す。
var ErrQueueFull = errors.New("mail: queue is full")

// QueueOptions は Queue の設定。
type QueueOptions struct {
	// Size は積んでおけるメールの数。超えた分は ErrQueueFull で断る（メモリを際限なく使わないため）。
	Size int
	// Attempts は 1 通を送る試行の回数（最初の 1 回を含む）。5xx の応答は送り直しても通らないので、残りがあっても諦める。
	Attempts int
	// Backoff は試行の間に待つ時間。2 回目以降は倍にしていく。
	Backoff time.Duration
	// SendTimeout は 1 回の試行（接続から送り終わりまで）の上限。
	SendTimeout time.Duration
	// DrainTimeout は、停止の合図の後に、積まれた分を送り切るのに使う時間の上限。
	DrainTimeout time.Duration
}

// DefaultQueueOptions は本番の既定。DrainTimeout は SHUTDOWN_TIMEOUT に合わせて呼び出し側が入れる。
var DefaultQueueOptions = QueueOptions{
	Size:        1024,
	Attempts:    3,
	Backoff:     2 * time.Second,
	SendTimeout: 30 * time.Second,
}

// Queue はメールをプロセスの中のキューに積み、別の goroutine（Run）で送る Sender（ADR 0053 決定 6）。
//
// 呼び出し側（リクエストの処理）は SMTP のやりとりを待たずに戻れる。パスワードの再設定では、
// 登録のある人にだけメールを送るので、送信を待つと応答の時間の差でアカウントの有無が分かってしまう。
// 積むだけなら、ある人とない人で時間が変わらない。
//
// 送れなかったメールは失う（数回だけ送り直す。プロセスが落ちたら積んだ分は消える）。
// 送るのは確認と再設定のメールだけで、どちらも画面からやり直せるので、DB に持つ outbox にはしない。
type Queue struct {
	sender Sender
	opts   QueueOptions
	logger *slog.Logger
	ch     chan Message
}

// NewQueue は Queue を返す。送り始めるには Run を動かす。
func NewQueue(sender Sender, opts QueueOptions, logger *slog.Logger) *Queue {
	if opts.Size <= 0 || opts.Attempts <= 0 {
		// 設定の組み立ての誤り。リクエストの処理では起きない。
		panic("mail: queue size and attempts must be positive")
	}
	return &Queue{sender: sender, opts: opts, logger: logger, ch: make(chan Message, opts.Size)}
}

// Send は m をキューに積んですぐに戻る。積めたことは、届いたことを意味しない。
func (q *Queue) Send(_ context.Context, m Message) error {
	select {
	case q.ch <- m:
		return nil
	default:
		return ErrQueueFull
	}
}

// Run は積まれたメールを 1 通ずつ送る。ctx が取り消されたら、残りを DrainTimeout の間だけ送ってから戻る。
//
// ctx はサーバーが新しいリクエストを受け付けなくなった後に取り消すこと。先に取り消すと、
// 停止の途中で処理を終えたリクエストが積んだメールを送り残す。
func (q *Queue) Run(ctx context.Context) {
	// 送信そのものは ctx の取り消しでは止めない。送っている途中の 1 通を切ると、それを失うため。
	// 止めるのは、停止の合図から DrainTimeout が過ぎたときだけにする。
	sendCtx, cancelSend := context.WithCancel(context.WithoutCancel(ctx))
	defer cancelSend()
	// 時計を動かし始めるのは ctx が取り消された瞬間（送り直しの途中でも）。drain に入るのを待ってからにすると、
	// 送り直しの分だけ停止が SHUTDOWN_TIMEOUT を超えてしまう。
	var drainTimer atomic.Pointer[time.Timer]
	stopWatch := context.AfterFunc(ctx, func() {
		drainTimer.Store(time.AfterFunc(q.opts.DrainTimeout, cancelSend))
	})
	defer func() {
		stopWatch()
		if t := drainTimer.Load(); t != nil {
			t.Stop()
		}
	}()

	for {
		// select は準備のできた case から無作為に選ぶので、取り消された後にも通常の送信に進みうる。先に確かめて drain に回す。
		if ctx.Err() != nil {
			q.drain(sendCtx)
			return
		}
		select {
		case <-ctx.Done():
			q.drain(sendCtx)
			return
		case m := <-q.ch:
			q.deliver(sendCtx, m)
		}
	}
}

// drain は停止の合図の後に、積まれた分を送り切ろうとする。時間切れで残った分は数だけログに出す。
func (q *Queue) drain(ctx context.Context) {
	for {
		if ctx.Err() != nil {
			if n := len(q.ch); n > 0 {
				q.logger.ErrorContext(ctx, "mail queue: dropped on shutdown", slog.Int("count", n))
			}
			return
		}
		select {
		case m := <-q.ch:
			q.deliver(ctx, m)
		default:
			return
		}
	}
}

// deliver は 1 通を、試行の回数まで送り直す。宛先・本文・リンクはログに出さない（CLAUDE.md「ログ」）。
func (q *Queue) deliver(ctx context.Context, m Message) {
	backoff := q.opts.Backoff
	var err error
	for attempt := 1; attempt <= q.opts.Attempts; attempt++ {
		if attempt > 1 {
			if !wait(ctx, backoff) {
				break
			}
			backoff *= 2
		}
		err = q.try(ctx, m)
		if err == nil {
			return
		}
		if Permanent(err) || ctx.Err() != nil {
			break
		}
		q.logger.WarnContext(ctx, "mail queue: send failed, retrying",
			slog.String("kind", m.Kind), slog.Int("attempt", attempt), slog.Any("error", err))
	}
	q.logger.ErrorContext(ctx, "mail queue: gave up", slog.String("kind", m.Kind), slog.Any("error", err))
}

func (q *Queue) try(ctx context.Context, m Message) error {
	if q.opts.SendTimeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, q.opts.SendTimeout)
		defer cancel()
	}
	if err := q.sender.Send(ctx, m); err != nil {
		return fmt.Errorf("send %s: %w", m.Kind, err)
	}
	return nil
}

// wait は d だけ待つ。ctx が先に終わったら false を返す。
func wait(ctx context.Context, d time.Duration) bool {
	if d <= 0 {
		return ctx.Err() == nil
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-t.C:
		return true
	}
}
