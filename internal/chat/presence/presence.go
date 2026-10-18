// Package presence は presence（オンラインか）と typing（入力中か）を Redis に置く。
//
// どちらも失われても困らない一時的な状態なので、Postgres には書かず、TTL 付きのキーだけで持つ（CLAUDE.md ルール 5）。
// 最終オンライン時刻は持たない。手動の離席は本人の設定なので Postgres（ADR 0049 決定 1・4）。
//
// presence は複数のインスタンスで数える（ADR 0016）。ユーザーごとのハッシュ presence:{userID} に、
// そのユーザーの接続を持つインスタンスの ID をフィールドとして置き、フィールドごとに TTL を付ける（HEXPIRE。Redis 7.4 以降）。
// インスタンスが落ちても、そのフィールドは TTL で消える。
//
// **フィールドの値は「そのインスタンスで画面を見ている接続の数」**（ADR 0049 決定 2）。
// フィールドが無ければオフライン、あるが値が全部 0 なら離席（idle）、1 つでも 1 以上ならオンライン（active）。
// 「見ているか」はクライアントが activity で知らせる。
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

// State は presence の状態（ADR 0049 決定 1）。値は docs/events.md の presence と同じ文字列。
type State string

const (
	// StateOffline は接続がない。
	StateOffline State = "offline"
	// StateIdle は接続はあるが、どれも画面を見ていない。
	StateIdle State = "idle"
	// StateActive はどこか 1 つの接続が画面を見ている。
	StateActive State = "active"
)

// states は Lua が返す番号（0 / 1 / 2）との対応。順番を変えない（スクリプトが ARGV の位置で選ぶ）。
var states = [3]State{StateOffline, StateIdle, StateActive}

// Announcement は presence が変わったときに publish するイベント。
//
// presence はイベントの中身を知らない。状態の変更と publish を 1 つの Lua スクリプトで行うために、publish する形を受け取るだけ。
// **状態ごとの中身を渡す**のは、どの状態になるかを決めるのが Lua（ほかのインスタンスのフィールドも見る）だから。
// Go の側で 1 つに決めて渡すと、決めてから publish するまでの間に別のインスタンスが状態を変えたときに、古い状態を配ってしまう。
type Announcement struct {
	Channels []string
	// Payloads は状態ごとの publish する中身。空なら publish しない。
	Payloads map[State][]byte
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

// syncScript は、このインスタンスの「接続の数」と「そのうち画面を見ている数」を記録し、
// ユーザー全体の状態が変わったときだけ publish する（ADR 0049 決定 2）。
//
// 接続・切断・activity の 3 つを 1 本にまとめてあるのは、どれも「フィールドを書いて状態を測り直す」同じ処理だから。
// 状態の判定と publish を同じスクリプトの中で行う理由は ADR 0016 のまま（イベントの順序が Redis の中の順序と入れ替わらない）。
//
// KEYS[1] = presence:{userID}
// ARGV = instance, ttl 秒, 接続の数, 見ている接続の数, offline の payload, idle の payload, active の payload, channel...
var syncScript = goredis.NewScript(`
local function state(key)
  local fields = redis.call('HKEYS', key)
  if #fields == 0 then
    return 0
  end
  for i = 1, #fields do
    if tonumber(redis.call('HGET', key, fields[i]) or '0') > 0 then
      return 2
    end
  end
  return 1
end

local before = state(KEYS[1])
if tonumber(ARGV[3]) > 0 then
  redis.call('HSET', KEYS[1], ARGV[1], ARGV[4])
  redis.call('HEXPIRE', KEYS[1], ARGV[2], 'FIELDS', 1, ARGV[1])
else
  redis.call('HDEL', KEYS[1], ARGV[1])
end
local after = state(KEYS[1])
if before ~= after and #ARGV >= 8 then
  for i = 8, #ARGV do
    redis.call('PUBLISH', ARGV[i], ARGV[5 + after])
  end
end
return after
`)

// refreshScript は、このインスタンスのフィールドを置き直して TTL を延ばす（イベントは出さない）。
// フィールドは自分しか書かないので、いまの「見ている接続の数」でそのまま上書きしてよい。
// KEYS = presence:{userID}..., ARGV = instance, ttl 秒, 見ている接続の数（KEYS と同じ並び）
var refreshScript = goredis.NewScript(`
for i = 1, #KEYS do
  redis.call('HSET', KEYS[i], ARGV[1], ARGV[i + 2])
  redis.call('HEXPIRE', KEYS[i], ARGV[2], 'FIELDS', 1, ARGV[1])
end
return #KEYS
`)

// stateScript は、キーごとの状態（0 = offline / 1 = idle / 2 = active）を返す。
var stateScript = goredis.NewScript(`
local out = {}
for i = 1, #KEYS do
  local fields = redis.call('HKEYS', KEYS[i])
  out[i] = 0
  for j = 1, #fields do
    if tonumber(redis.call('HGET', KEYS[i], fields[j]) or '0') > 0 then
      out[i] = 2
      break
    end
    out[i] = 1
  end
end
return out
`)

var ttlSeconds = strconv.Itoa(int(OnlineTTL / time.Second))

// Sync は、このインスタンスの userID の接続の数（conns）と、そのうち画面を見ている数（active）を記録する。
// ユーザー全体の状態が変わったら ann を publish し、変更後の状態を返す。
func (s *Store) Sync(ctx context.Context, userID ulid.ULID, conns, active int, ann Announcement) (State, error) {
	args := []any{s.instance, ttlSeconds, conns, active}
	for _, st := range states {
		args = append(args, ann.Payloads[st])
	}
	for _, ch := range ann.Channels {
		args = append(args, ch)
	}
	n, err := syncScript.Run(ctx, s.rdb, []string{onlineKey(userID)}, args...).Int()
	if err != nil {
		return StateOffline, fmt.Errorf("sync presence: %w", err)
	}
	return stateOf(n), nil
}

// Refresh は、このインスタンスに接続があるユーザーのフィールドを置き直して TTL を延ばす。
// counts はユーザーごとの「見ている接続の数」。
func (s *Store) Refresh(ctx context.Context, counts map[ulid.ULID]int) error {
	if len(counts) == 0 {
		return nil
	}
	keys := make([]string, 0, len(counts))
	args := []any{s.instance, ttlSeconds}
	for userID, active := range counts {
		keys = append(keys, onlineKey(userID))
		args = append(args, active)
	}
	if err := refreshScript.Run(ctx, s.rdb, keys, args...).Err(); err != nil {
		return fmt.Errorf("refresh presence: %w", err)
	}
	return nil
}

// States は userIDs の状態を返す。1 回の往復で読む（一覧で N+1 にしない）。
func (s *Store) States(ctx context.Context, userIDs []ulid.ULID) (map[ulid.ULID]State, error) {
	out := make(map[ulid.ULID]State, len(userIDs))
	if len(userIDs) == 0 {
		return out, nil
	}
	values, err := stateScript.RunRO(ctx, s.rdb, onlineKeys(userIDs)).Int64Slice()
	if err != nil {
		return nil, fmt.Errorf("get presence: %w", err)
	}
	for i, v := range values {
		out[userIDs[i]] = stateOf(int(v))
	}
	return out, nil
}

// stateOf は Lua が返す番号を State にする。想定外の値は offline にする（見えないだけで壊れない）。
func stateOf(n int) State {
	if n < 0 || n >= len(states) {
		return StateOffline
	}
	return states[n]
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
