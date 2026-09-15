package realtime

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/oklog/ulid/v2"
	goredis "github.com/redis/go-redis/v9"

	"github.com/shun2218-dev/hibari/internal/chat"
	"github.com/shun2218-dev/hibari/internal/chat/presence"
	"github.com/shun2218-dev/hibari/internal/platform/id"
)

// Redis Pub/Sub による配信（ロードマップ Phase 5、ADR 0016）。
//
//	RedisDelivery: chat.Delivery の実装。イベントを宛先のチャンネル（room / workspace / user）に publish するだけ。
//	Broker:        このインスタンスの接続が購読しているチャンネルだけを Redis で購読し、届いたイベントを Hub に渡す。
//
// 自分のインスタンスで起きたイベントも、直接は配らずに Redis から受け取る。経路を 1 本にして、どのインスタンスでも
// イベントが同じ順序で並ぶようにするため。Redis Pub/Sub は at-most-once なので、配信は落ちうる（ADR 0004）。

const (
	// PublishTimeout は 1 件のイベントの publish を待つ上限。Redis が落ちていても、送信 API のレスポンスを長く止めない。
	PublishTimeout = 2 * time.Second
	// SubscribeTimeout は、チャンネルの購読を Redis が確認するまで待つ上限。
	SubscribeTimeout = 5 * time.Second
	// healthCheckInterval の間なにも受け取らなければ PING を送り、切れた接続に気づく（go-redis の Channel と同じ既定値）。
	healthCheckInterval = 3 * time.Second
	// recentIDsSize は重複を除くために覚えておくイベントの ID の数。
	recentIDsSize = 4096
	// pingPrefix は購読の確認に使う PING の payload の接頭辞。ヘルスチェックの PING と区別する。
	pingPrefix = "sync:"
)

// ErrResubscribed は、購読の確認を待っている間に Redis との接続が張り直されたことを表す。
var ErrResubscribed = errors.New("realtime: redis pubsub reconnected")

// RedisDelivery はイベントを Redis に publish する chat.Delivery。
type RedisDelivery struct {
	rdb    *goredis.Client
	ids    id.Generator
	logger *slog.Logger
}

var _ Publisher = (*RedisDelivery)(nil)

// NewRedisDelivery は RedisDelivery を返す。
func NewRedisDelivery(rdb *goredis.Client, ids id.Generator, logger *slog.Logger) *RedisDelivery {
	return &RedisDelivery{rdb: rdb, ids: ids, logger: logger}
}

// Deliver はイベントを宛先のチャンネルに publish する。失敗してもエラーを返さず、ログに残す（chat.Delivery）。
// 永続化はコミット済みなので、クライアントは change_seq の欠番と再接続時の差分取得で回復する（ADR 0004 / 0014）。
func (p *RedisDelivery) Deliver(ctx context.Context, ev chat.Event) {
	ann, err := p.Announcement(ev)
	if err != nil {
		p.logger.ErrorContext(ctx, "encode event failed", slog.String("event", string(ev.Type)), slog.Any("error", err))
		return
	}
	if len(ann.Channels) == 0 {
		return
	}
	ctx, cancel := context.WithTimeout(ctx, PublishTimeout)
	defer cancel()
	// 1 往復で送る。同じイベントのコピーが続けて届くので、受け取る側の重複の除去が少ない記憶で済む。
	_, err = p.rdb.Pipelined(ctx, func(pipe goredis.Pipeliner) error {
		for _, ch := range ann.Channels {
			pipe.Publish(ctx, ch, ann.Payload)
		}
		return nil
	})
	if err != nil {
		p.logger.ErrorContext(ctx, "publish event failed", slog.String("event", string(ev.Type)), slog.Any("error", err))
	}
}

// Announcement はイベントを publish する形（チャンネルと payload）にする。
// presence の変化は、状態の変更と同じ Lua スクリプトの中で publish するので、この形を presence.Store に渡す（ADR 0016）。
func (p *RedisDelivery) Announcement(ev chat.Event) (presence.Announcement, error) {
	channels := channelsFor(ev)
	payload, err := encodeWire(ev, p.ids.New(), len(channels))
	if err != nil {
		return presence.Announcement{}, err
	}
	return presence.Announcement{Channels: channels, Payload: payload}, nil
}

// Receiver は Broker が受け取ったものを渡す先（Hub が実装する）。
type Receiver interface {
	// DeliverLocal はイベントを、このインスタンスの接続に届ける。
	DeliverLocal(ctx context.Context, ev chat.Event)
	// Resync は、Redis との接続が張り直されてイベントを取りこぼしたかもしれないときに呼ばれる。
	Resync(ctx context.Context)
}

// Broker は、このインスタンスの接続が必要とするチャンネルを Redis で購読し、届いたイベントを Receiver に渡す。
//
// チャンネルごとに購読の数を数え、0 → 1 で SUBSCRIBE、1 → 0 で UNSUBSCRIBE する。
// Acquire は Redis が購読を反映するまで待つ。そうしないと「購読の ack を受け取ってから REST を読めば取りこぼさない」
// （docs/events.md の同期の手順）が、複数台では成り立たない。
type Broker struct {
	ps     *goredis.PubSub
	logger *slog.Logger
	// control はこのインスタンスだけが購読するチャンネル。Redis との接続が張り直されると go-redis が購読し直し、
	// その確認がもう一度届くので、再接続に気づける（go-redis は再接続を知らせる API を持たない）。
	control string

	// writeMu は SUBSCRIBE / UNSUBSCRIBE / 購読の確認の PING の送信と、seq の採番を同じ順序にする。
	writeMu sync.Mutex
	// seq は送った SUBSCRIBE と PING の通し番号（writeMu で守る）。
	seq uint64

	mu sync.Mutex
	// refs はチャンネルごとの購読の数。
	refs map[string]int
	// subscribedAt はチャンネルの最後の SUBSCRIBE の番号。
	subscribedAt map[string]uint64
	// acked は、PONG が返ってきた PING の番号の最大値。Redis はコマンドを届いた順に処理するので、
	// acked 以前に送った SUBSCRIBE はすべて反映されている。
	acked   uint64
	waiters map[uint64]chan error
	closed  bool
}

// NewBroker は Broker を作り、このインスタンスの制御用のチャンネルを Redis が購読するまで待ってから返す。
func NewBroker(ctx context.Context, rdb *goredis.Client, instanceID ulid.ULID, logger *slog.Logger) (*Broker, error) {
	control := "realtime:instance:" + instanceID.String()
	ps := rdb.Subscribe(ctx, control)
	if _, err := ps.Receive(ctx); err != nil {
		_ = ps.Close()
		return nil, fmt.Errorf("subscribe %s: %w", control, err)
	}
	return &Broker{
		ps:           ps,
		logger:       logger,
		control:      control,
		refs:         map[string]int{},
		subscribedAt: map[string]uint64{},
		waiters:      map[uint64]chan error{},
	}, nil
}

// Acquire はチャンネルの購読を 1 つ増やし、Redis が購読を反映するまで待つ。成功したら、後で必ず Release を呼ぶ。
func (b *Broker) Acquire(ctx context.Context, channel string) error {
	ctx, cancel := context.WithTimeout(ctx, SubscribeTimeout)
	defer cancel()

	b.writeMu.Lock()
	b.mu.Lock()
	if b.closed {
		b.mu.Unlock()
		b.writeMu.Unlock()
		return goredis.ErrClosed
	}
	b.refs[channel]++
	first := b.refs[channel] == 1
	b.mu.Unlock()
	if first {
		if err := b.ps.Subscribe(ctx, channel); err != nil {
			b.writeMu.Unlock()
			b.Release(channel)
			return fmt.Errorf("subscribe %s: %w", channel, err)
		}
		b.seq++
		b.mu.Lock()
		b.subscribedAt[channel] = b.seq
		b.mu.Unlock()
	}

	b.mu.Lock()
	confirmed := b.subscribedAt[channel] <= b.acked
	b.mu.Unlock()
	if confirmed {
		// 前に送った SUBSCRIBE を Redis が処理済み。
		b.writeMu.Unlock()
		return nil
	}
	// SUBSCRIBE の後に PING を送り、その PONG が返れば SUBSCRIBE も処理済み。
	if err := b.pingAndWait(ctx); err != nil {
		b.Release(channel)
		return fmt.Errorf("confirm subscription %s: %w", channel, err)
	}
	return nil
}

// Sync は、呼んだ時点までに Redis が受け付けた publish を、このインスタンスが受け取って Receiver に渡し終えるまで待つ。
// 受信の goroutine は届いた順に処理するので、ここで送った PING の PONG を受け取った時点で、それより前のメッセージは渡し終えている。
func (b *Broker) Sync(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, SubscribeTimeout)
	defer cancel()
	b.writeMu.Lock()
	return b.pingAndWait(ctx)
}

// pingAndWait は番号付きの PING を送り、その PONG を受け取るまで待つ。writeMu を持って呼び、送信の後に writeMu を外す。
func (b *Broker) pingAndWait(ctx context.Context) error {
	b.mu.Lock()
	if b.closed {
		b.mu.Unlock()
		b.writeMu.Unlock()
		return goredis.ErrClosed
	}
	b.seq++
	token := b.seq
	done := make(chan error, 1)
	b.waiters[token] = done
	b.mu.Unlock()
	err := b.ps.Ping(ctx, pingPrefix+strconv.FormatUint(token, 10))
	b.writeMu.Unlock()
	if err == nil {
		select {
		case err = <-done:
		case <-ctx.Done():
			err = ctx.Err()
		}
	}
	if err != nil {
		b.mu.Lock()
		delete(b.waiters, token)
		b.mu.Unlock()
	}
	return err
}

// Release はチャンネルの購読を 1 つ減らし、0 になったら UNSUBSCRIBE する。
func (b *Broker) Release(channel string) {
	b.writeMu.Lock()
	defer b.writeMu.Unlock()
	b.mu.Lock()
	b.refs[channel]--
	last := b.refs[channel] <= 0
	if last {
		delete(b.refs, channel)
		delete(b.subscribedAt, channel)
	}
	closed := b.closed
	b.mu.Unlock()
	if !last || closed {
		return
	}
	// go-redis は送信の前に購読の一覧から外すので、送れなくても再接続のときに購読し直されることはない。
	ctx, cancel := context.WithTimeout(context.Background(), PublishTimeout)
	defer cancel()
	if err := b.ps.Unsubscribe(ctx, channel); err != nil {
		b.logger.WarnContext(ctx, "unsubscribe failed", slog.String("channel", channel), slog.Any("error", err))
	}
}

// Channels は購読の数が 1 以上のチャンネルの数を返す（テストと監視用）。
func (b *Broker) Channels() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return len(b.refs)
}

// Run は ctx がキャンセルされるまでイベントを受け取り、r に渡す。戻るときに購読を閉じる。
//
// 受け取りは 1 本の goroutine だけで行い、Hub への受け渡しも同じ goroutine で順番に行う（届いた順に配る）。
// go-redis の Channel は使わない。Channel は受け手が遅いとメッセージを黙って捨てるが、ここで直接読めば、
// 遅れは Redis の出力バッファに溜まり、上限を超えれば Redis が接続を切るので、再接続として検知して Resync できる。
func (b *Broker) Run(ctx context.Context, r Receiver) {
	stop := context.AfterFunc(ctx, func() { _ = b.close() })
	defer stop()
	defer func() { _ = b.close() }()

	recent := newRecentIDs(recentIDsSize)
	failures := 0
	for {
		msg, err := b.ps.ReceiveTimeout(ctx, healthCheckInterval)
		if err != nil {
			if ctx.Err() != nil || errors.Is(err, goredis.ErrClosed) {
				return
			}
			var netErr net.Error
			if errors.As(err, &netErr) && netErr.Timeout() {
				// しばらく何も届かない。PING を送り、書き込みに失敗すれば go-redis が接続を張り直す。
				_ = b.ps.Ping(ctx)
				continue
			}
			// 接続が切れた。1 回目は go-redis がすでに張り直しているので、すぐに受信に戻る。
			// 続けて失敗するなら Redis に接続できないので、待ってから試す（ログと接続の試行で埋め尽くさない）。
			failures++
			if failures == 1 {
				continue
			}
			b.logger.WarnContext(ctx, "redis pubsub receive failed", slog.Int("failures", failures), slog.Any("error", err))
			select {
			case <-ctx.Done():
				return
			case <-time.After(time.Second):
			}
			continue
		}
		failures = 0
		switch m := msg.(type) {
		case *goredis.Subscription:
			if m.Kind == "subscribe" && m.Channel == b.control {
				b.resubscribed(ctx, r)
			}
		case *goredis.Pong:
			b.pong(m.Payload)
		case *goredis.Message:
			w, ev, err := decodeWire([]byte(m.Payload))
			if err != nil {
				b.logger.WarnContext(ctx, "ignored realtime message", slog.String("channel", m.Channel), slog.Any("error", err))
				continue
			}
			if w.Fanout > 1 && recent.seen(w.ID) {
				continue
			}
			// 宛先はチャンネルではなくイベントの宛先全体で解決する。どのコピーが先に届いても、1 回で全員に配れる。
			r.DeliverLocal(ctx, ev)
		}
	}
}

// pong は購読の確認の PONG を受け取り、その番号までに送った SUBSCRIBE を待っている Acquire を起こす。
func (b *Broker) pong(payload string) {
	token, err := strconv.ParseUint(strings.TrimPrefix(payload, pingPrefix), 10, 64)
	if !strings.HasPrefix(payload, pingPrefix) || err != nil {
		return // ヘルスチェックの PING
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if token > b.acked {
		b.acked = token
	}
	for t, done := range b.waiters {
		if t <= b.acked {
			done <- nil
			delete(b.waiters, t)
		}
	}
}

// resubscribed は Redis との接続が張り直されたときに呼ばれる。切れていた間のイベントは失われているので、
// 確認を待っている Acquire を失敗させ、Receiver に同期し直させる（接続を切り、クライアントに差分を取らせる）。
func (b *Broker) resubscribed(ctx context.Context, r Receiver) {
	b.logger.WarnContext(ctx, "redis pubsub reconnected; resyncing websocket clients")
	b.mu.Lock()
	for t, done := range b.waiters {
		done <- ErrResubscribed
		delete(b.waiters, t)
	}
	b.mu.Unlock()
	r.Resync(ctx)
}

func (b *Broker) close() error {
	b.mu.Lock()
	if b.closed {
		b.mu.Unlock()
		return nil
	}
	b.closed = true
	for t, done := range b.waiters {
		done <- goredis.ErrClosed
		delete(b.waiters, t)
	}
	b.mu.Unlock()
	return b.ps.Close()
}
