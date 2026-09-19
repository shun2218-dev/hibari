// Package presence は presence（オンラインか）と typing（入力中か）を Redis に置く。
//
// どちらも失われても困らない一時的な状態なので、Postgres には書かず、TTL 付きのキーだけで持つ（CLAUDE.md ルール 5）。
// 最終オンライン時刻や離席は持たない（docs/ui の「presence はオンラインのドットだけ」）。
//
// presence は複数のインスタンスで数える（ADR 0016）。ユーザーごとのハッシュ presence:{userID} に、
// そのユーザーの接続を持つインスタンスの ID をフィールドとして置き、フィールドごとに TTL を付ける（HEXPIRE。Redis 7.4 以降）。
// フィールドが 1 つでも残っていればオンライン。インスタンスが落ちても、そのフィールドは TTL で消える。
package presence

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"github.com/oklog/ulid/v2"
	goredis "github.com/redis/go-redis/v9"
)

const (
	// OnlineTTL は presence のフィールドの寿命。接続が残っている間は、インスタンスが RefreshInterval ごとに延ばす（ADR 0015）。
	// インスタンスが落ちて offline のイベントが出なくても、この時間で REST の online は false に戻る。
	OnlineTTL = 60 * time.Second
	// RefreshInterval は presence の TTL を延ばす間隔。OnlineTTL より十分短くして、1 回の遅れでオフラインに見えないようにする。
	RefreshInterval = 30 * time.Second
	// TypingTTL は typing のキーの寿命。この間は同じユーザーの同じルームの typing.started を配信し直さない。
	TypingTTL = 5 * time.Second
)

// Announcement は presence が変わったときに publish するイベント。
// presence はイベントの中身を知らない。状態の変更と publish を 1 つの Lua スクリプトで行うために、publish する形を受け取るだけ。
type Announcement struct {
	Channels []string
	Payload  []byte
}

// Store は presence と typing の Redis の読み書き。
type Store struct {
	rdb *goredis.Client
	// instance はこのプロセスの ID。presence のハッシュのフィールドにする。
	instance string
}

// New は Store を返す。instanceID はプロセスごとに一意にする（起動のたびに作る ULID）。
func New(rdb *goredis.Client, instanceID ulid.ULID) *Store {
	return &Store{rdb: rdb, instance: instanceID.String()}
}

func onlineKey(userID ulid.ULID) string {
	return "presence:" + userID.String()
}

// typingKey はチャンネルなら typing:{roomID}:{userID}、スレッドなら末尾に :{threadRootID} を足す（ADR 0036）。
// スレッドとチャンネルを別に間引かないと、片方で入力した直後にもう片方の入力中が 5 秒届かない。
func typingKey(roomID, userID ulid.ULID, threadRootID *ulid.ULID) string {
	key := "typing:" + roomID.String() + ":" + userID.String()
	if threadRootID != nil {
		key += ":" + threadRootID.String()
	}
	return key
}

// 状態の変更と publish を 1 つのスクリプトで行う理由（ADR 0016）:
// インスタンス A の「最後の切断」とインスタンス B の「最初の接続」が並行したとき、判定と publish を別々に行うと、
// Redis の中の順序は「offline → online」なのに、publish の順序が「online → offline」に入れ替わり、
// 接続しているのにオフラインに見えることがある。スクリプトの中で publish すれば、状態が変わった順にイベントが並ぶ。
//
// フィールドの数は HLEN ではなく HKEYS で数える。HLEN は期限が切れてまだ回収されていないフィールドも数えるため。

// connectScript は、このインスタンスのフィールドを置き、置く前にフィールドがなかったら（最初の接続なら）publish する。
// KEYS[1] = presence:{userID}, ARGV = instance, ttl 秒, payload, channel...
var connectScript = goredis.NewScript(`
local before = #redis.call('HKEYS', KEYS[1])
redis.call('HSET', KEYS[1], ARGV[1], '1')
redis.call('HEXPIRE', KEYS[1], ARGV[2], 'FIELDS', 1, ARGV[1])
if before > 0 then
  return 0
end
for i = 4, #ARGV do
  redis.call('PUBLISH', ARGV[i], ARGV[3])
end
return 1
`)

// disconnectScript は、このインスタンスのフィールドを消し、残りがなければ（最後の切断なら）publish する。
// KEYS[1] = presence:{userID}, ARGV = instance, payload, channel...
var disconnectScript = goredis.NewScript(`
redis.call('HDEL', KEYS[1], ARGV[1])
if #redis.call('HKEYS', KEYS[1]) > 0 then
  return 0
end
for i = 3, #ARGV do
  redis.call('PUBLISH', ARGV[i], ARGV[2])
end
return 1
`)

// refreshScript は、このインスタンスのフィールドの TTL を延ばす。消えていたら置き直す（イベントは出さない）。
// KEYS = presence:{userID}..., ARGV = instance, ttl 秒
var refreshScript = goredis.NewScript(`
for i = 1, #KEYS do
  redis.call('HSET', KEYS[i], ARGV[1], '1')
  redis.call('HEXPIRE', KEYS[i], ARGV[2], 'FIELDS', 1, ARGV[1])
end
return #KEYS
`)

// onlineScript は、キーごとに期限内のフィールドが残っているか（1 / 0）を返す。
var onlineScript = goredis.NewScript(`
local out = {}
for i = 1, #KEYS do
  out[i] = (#redis.call('HKEYS', KEYS[i]) > 0) and 1 or 0
end
return out
`)

func scriptArgs(head []any, ann Announcement) []any {
	args := append(head, ann.Payload)
	for _, ch := range ann.Channels {
		args = append(args, ch)
	}
	return args
}

var ttlSeconds = strconv.Itoa(int(OnlineTTL / time.Second))

// Connect は、このインスタンスに userID の接続があることを記録する。
// どのインスタンスにも接続がなかった（ユーザーがオフラインだった）なら、ann を publish して true を返す。
func (s *Store) Connect(ctx context.Context, userID ulid.ULID, ann Announcement) (bool, error) {
	n, err := connectScript.Run(ctx, s.rdb, []string{onlineKey(userID)}, scriptArgs([]any{s.instance, ttlSeconds}, ann)...).Int()
	if err != nil {
		return false, fmt.Errorf("connect presence: %w", err)
	}
	return n == 1, nil
}

// Disconnect は、このインスタンスに userID の接続がなくなったことを記録する。
// ほかのインスタンスにも接続がなければ（ユーザーがオフラインになったら）、ann を publish して true を返す。
func (s *Store) Disconnect(ctx context.Context, userID ulid.ULID, ann Announcement) (bool, error) {
	n, err := disconnectScript.Run(ctx, s.rdb, []string{onlineKey(userID)}, scriptArgs([]any{s.instance}, ann)...).Int()
	if err != nil {
		return false, fmt.Errorf("disconnect presence: %w", err)
	}
	return n == 1, nil
}

// Refresh は、このインスタンスに接続がある userIDs の TTL を OnlineTTL に延ばす。
func (s *Store) Refresh(ctx context.Context, userIDs ...ulid.ULID) error {
	if len(userIDs) == 0 {
		return nil
	}
	if err := refreshScript.Run(ctx, s.rdb, onlineKeys(userIDs), s.instance, ttlSeconds).Err(); err != nil {
		return fmt.Errorf("refresh presence: %w", err)
	}
	return nil
}

// Online は userIDs のうちオンラインのユーザーを返す。1 回の往復で読む（一覧で N+1 にしない）。
func (s *Store) Online(ctx context.Context, userIDs []ulid.ULID) (map[ulid.ULID]bool, error) {
	online := make(map[ulid.ULID]bool, len(userIDs))
	if len(userIDs) == 0 {
		return online, nil
	}
	values, err := onlineScript.RunRO(ctx, s.rdb, onlineKeys(userIDs)).Int64Slice()
	if err != nil {
		return nil, fmt.Errorf("get presence: %w", err)
	}
	for i, v := range values {
		if v == 1 {
			online[userIDs[i]] = true
		}
	}
	return online, nil
}

func onlineKeys(userIDs []ulid.ULID) []string {
	keys := make([]string, len(userIDs))
	for i, id := range userIDs {
		keys[i] = onlineKey(id)
	}
	return keys
}

// StartTyping は userID がルーム（threadRootID を渡したらそのスレッド）で入力中であることを TypingTTL の間だけ記録する。
// すでに記録されていれば何もせず false を返す。true のときだけ typing.started を配信する（配信を 5 秒に 1 回に間引く。ADR 0015）。
func (s *Store) StartTyping(ctx context.Context, roomID, userID ulid.ULID, threadRootID *ulid.ULID) (bool, error) {
	ok, err := s.rdb.SetNX(ctx, typingKey(roomID, userID, threadRootID), "1", TypingTTL).Result()
	if err != nil {
		return false, fmt.Errorf("set typing: %w", err)
	}
	return ok, nil
}
