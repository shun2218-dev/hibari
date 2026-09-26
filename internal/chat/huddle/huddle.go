// Package huddle は、ハドルに「いま入っている人」を Redis に置く（ADR 0066 決定 3・5・6）。
//
// 入っている人・心拍の期限・「もうすぐ参加する」は自動で変わる状態なので、Postgres には書かない（CLAUDE.md ルール 5）。
// ハドルの履歴（始めた・終わった・一度でも入った人）は Postgres にあり、それを扱うのは chat の側。
//
// キー（huddleID・userID・participantID は ULID の文字列）:
//
//	huddle:{huddleID}:members  HASH  participantID → 参加の JSON（Participant）
//	huddle:{huddleID}:version  STRING  状態の版。変わるたびに 1 増える（huddle.updated の順序を決める。決定 13）
//	huddle:{huddleID}:soon     ZSET  userID → 「もうすぐ参加する」の期限（ミリ秒。決定 11）
//	huddle_user:{userID}       STRING  "{huddleID} {participantID}"。1 人が入れるハドルは 1 つ（決定 6）
//	huddle_deadlines           ZSET  "{huddleID}/{participantID}" → 心拍の期限（ミリ秒）
//	huddle_ice:{userID}        ZSET  発行した TURN の認証情報のユーザー名 → 期限（ミリ秒）。外したときに取り消す（決定 8・14）
//
// **期限はハッシュの TTL ではなく、全体で 1 つのソート済みセットに持つ**（決定 5）。
// Redis の期限切れはイベントにならない（presence と同じ）が、ハドルでは消えた人をほかの人の画面から消し、
// 最後の人が消えたらハドルを終わらせる必要がある。掃除のジョブが期限を過ぎた参加を Lua で取り除き、取り除いたものだけを配る。
// 取り除くのは Lua の中なので、複数台で同時に掃除しても、同じ参加を片付けるのは 1 台だけになる。
//
// 時刻は呼び出し側が Clock から渡す（期限もミリ秒で渡す）。Redis の時計には頼らない（テストで時刻を固定するため）。
// huddle_user のキーは参加を外すときに必ず一緒に消す（remove）。キーの TTL（1 日）は、それが漏れたときの保険でしかない。
//
// どのスクリプトも ARGV の先頭でキーの名前空間（本番は空）を受け取り、取り除いてから使う（以下の ARGV の説明は、それを除いた並び）。
//
// スクリプトは KEYS に宣言していないキー（別のハドルのキー）にも触る。Redis Cluster では許されないが、
// hibari の Redis は 1 台（ADR 0046 の Valkey）なので、1 回の操作で原子的に済む方を選ぶ。
package huddle

import (
	"context"
	"encoding/json/v2"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/oklog/ulid/v2"
	goredis "github.com/redis/go-redis/v9"

	"github.com/shun2218-dev/hibari/internal/chat"
)

var _ chat.HuddleStates = (*Store)(nil)

// record は Redis に置く参加の JSON。chat の型に JSON のタグを持ち込まないよう、この中に閉じる。
type record struct {
	ID            ulid.ULID `json:"id"`
	HuddleID      ulid.ULID `json:"huddle_id"`
	UserID        ulid.ULID `json:"user_id"`
	AuthSessionID ulid.ULID `json:"auth_session_id"`
	SFUSessionID  string    `json:"sfu_session_id"`
	TrackName     string    `json:"track_name"`
	Muted         bool      `json:"muted"`
	JoinedAt      time.Time `json:"joined_at"`
}

// Store はハドルの状態の Redis の読み書き（chat.HuddleStates の実装）。
type Store struct {
	rdb *goredis.Client
	// ns はキーの前に付ける名前空間。本番は空。
	ns string
}

// New は Store を返す。
func New(rdb *goredis.Client) *Store {
	return &Store{rdb: rdb}
}

// NewNamespaced は、すべてのキーの前に ns を付ける Store を返す（テスト用）。
// 心拍の期限の一覧（huddle_deadlines）は全体で 1 つなので、並行に動くテストの掃除が互いの参加を外さないよう、テストごとに分ける。
func NewNamespaced(rdb *goredis.Client, ns string) *Store {
	return &Store{rdb: rdb, ns: ns}
}

func (s *Store) membersKey(huddleID ulid.ULID) string {
	return s.ns + "huddle:" + huddleID.String() + ":members"
}
func (s *Store) versionKey(huddleID ulid.ULID) string {
	return s.ns + "huddle:" + huddleID.String() + ":version"
}
func (s *Store) soonKey(huddleID ulid.ULID) string {
	return s.ns + "huddle:" + huddleID.String() + ":soon"
}
func (s *Store) userKey(userID ulid.ULID) string { return s.ns + "huddle_user:" + userID.String() }
func (s *Store) iceKey(userID ulid.ULID) string  { return s.ns + "huddle_ice:" + userID.String() }

func millis(t time.Time) string { return strconv.FormatInt(t.UnixMilli(), 10) }

// removeLua は、Lua の中で参加を 1 つ外す関数。ほかのスクリプトの先頭に付けて使う。
// 参加の JSON を返し、なければ false を返す。版を 1 増やす。
const removeLua = `
local NS = table.remove(ARGV, 1)
local function remove(huddle, participant)
  local members = NS .. 'huddle:' .. huddle .. ':members'
  local json = redis.call('HGET', members, participant)
  if not json then
    return false
  end
  redis.call('HDEL', members, participant)
  redis.call('ZREM', NS .. 'huddle_deadlines', huddle .. '/' .. participant)
  local user = cjson.decode(json)['user_id']
  local ukey = NS .. 'huddle_user:' .. user
  if redis.call('GET', ukey) == huddle .. ' ' .. participant then
    redis.call('DEL', ukey)
  end
  redis.call('INCR', NS .. 'huddle:' .. huddle .. ':version')
  return json
end
`

// joinScript は参加を書く（決定 4・6・7）。
//
// 同じ人がすでにどこかのハドルに入っていれば、その参加を先に外す（別のハドルなら抜ける、同じハドルなら別の端末から移る）。
// 外した参加は返し、呼び出し側が Cloudflare のトラックを閉じて、前の端末に huddle.left を送る。
// 人数の上限は、同じ人の前の参加を除いて数える（別の端末から移るだけなら人数は増えない）。上限に達していれば何も変えずに -1 を返す。
//
// KEYS: なし（キーはすべて ARGV から組み立てる）
// ARGV = huddleID, participantID, userID, 参加の JSON, 心拍の期限（ミリ秒）, 上限の人数
// 返り値 = { 版, 外した参加の JSON か false, 外した参加のハドルの版 }
var joinScript = goredis.NewScript(removeLua + `
local huddle, participant, user = ARGV[1], ARGV[2], ARGV[3]
local members = NS .. 'huddle:' .. huddle .. ':members'
local old = redis.call('GET', NS .. 'huddle_user:' .. user)
local oldHuddle, oldParticipant
if old then
  oldHuddle, oldParticipant = string.match(old, '^(%S+) (%S+)$')
end

local count = #redis.call('HKEYS', members)
if oldHuddle == huddle and redis.call('HEXISTS', members, oldParticipant) == 1 then
  count = count - 1
end
if count >= tonumber(ARGV[6]) then
  return {-1, false, 0}
end

local evicted = false
local evictedVersion = 0
if oldHuddle then
  evicted = remove(oldHuddle, oldParticipant)
  if evicted then
    evictedVersion = tonumber(redis.call('GET', NS .. 'huddle:' .. oldHuddle .. ':version'))
  end
end

redis.call('HSET', members, participant, ARGV[4])
redis.call('ZADD', NS .. 'huddle_deadlines', ARGV[5], huddle .. '/' .. participant)
redis.call('SET', NS .. 'huddle_user:' .. user, huddle .. ' ' .. participant, 'PX', 86400000)
redis.call('ZREM', NS .. 'huddle:' .. huddle .. ':soon', user)
local version = redis.call('INCR', NS .. 'huddle:' .. huddle .. ':version')
return {version, evicted, evictedVersion}
`)

// Join は参加を書く。deadline は最初の心拍の期限、limit は人数の上限。上限に達していれば chat.ErrHuddleFull。
func (s *Store) Join(ctx context.Context, p chat.HuddleParticipant, deadline time.Time, limit int) (chat.HuddleJoinResult, error) {
	payload, err := json.Marshal(record(p))
	if err != nil {
		return chat.HuddleJoinResult{}, fmt.Errorf("huddle: encode participant: %w", err)
	}
	res, err := joinScript.Run(ctx, s.rdb, nil, s.ns,
		p.HuddleID.String(), p.ID.String(), p.UserID.String(), payload, millis(deadline), limit).Slice()
	if err != nil {
		return chat.HuddleJoinResult{}, fmt.Errorf("huddle: join: %w", err)
	}
	version, _ := res[0].(int64)
	if version < 0 {
		return chat.HuddleJoinResult{}, chat.ErrHuddleFull
	}
	out := chat.HuddleJoinResult{Version: version}
	if raw, ok := res[1].(string); ok {
		evicted, err := decode(raw)
		if err != nil {
			return chat.HuddleJoinResult{}, err
		}
		evictedVersion, _ := res[2].(int64)
		remaining, err := s.count(ctx, evicted.HuddleID)
		if err != nil {
			return chat.HuddleJoinResult{}, err
		}
		out.Evicted = &chat.RemovedParticipant{Participant: evicted, Version: evictedVersion, Remaining: remaining}
	}
	return out, nil
}

// heartbeatScript は心拍の期限を延ばす（決定 5）。参加がもうなければ（外れた・別の端末に移った）0 を返す。
// ARGV = userID, huddleID, participantID, 新しい期限（ミリ秒）
var heartbeatScript = goredis.NewScript(`
local NS = table.remove(ARGV, 1)
local ukey = NS .. 'huddle_user:' .. ARGV[1]
if redis.call('GET', ukey) ~= ARGV[2] .. ' ' .. ARGV[3] then
  return 0
end
redis.call('ZADD', NS .. 'huddle_deadlines', 'XX', ARGV[4], ARGV[2] .. '/' .. ARGV[3])
redis.call('PEXPIRE', ukey, 86400000)
return 1
`)

// Heartbeat は参加の期限を deadline まで延ばす。参加がもうなければ false（クライアントは外れたと分かる。決定 5）。
func (s *Store) Heartbeat(ctx context.Context, userID, huddleID, participantID ulid.ULID, deadline time.Time) (bool, error) {
	n, err := heartbeatScript.Run(ctx, s.rdb, nil, s.ns, userID.String(), huddleID.String(), participantID.String(), millis(deadline)).Int()
	if err != nil {
		return false, fmt.Errorf("huddle: heartbeat: %w", err)
	}
	return n == 1, nil
}

// removeScript は参加を 1 つ外す。
// ARGV = huddleID, participantID
// 返り値 = { 参加の JSON か false, 版, 残りの人数 }
var removeScript = goredis.NewScript(removeLua + `
local json = remove(ARGV[1], ARGV[2])
local version = tonumber(redis.call('GET', NS .. 'huddle:' .. ARGV[1] .. ':version') or '0')
return {json, version, #redis.call('HKEYS', NS .. 'huddle:' .. ARGV[1] .. ':members')}
`)

// Remove は参加を外す（抜けた・外された。決定 4・8）。もう外れていれば nil を返す（何度呼んでもよい）。
func (s *Store) Remove(ctx context.Context, huddleID, participantID ulid.ULID) (*chat.RemovedParticipant, error) {
	res, err := removeScript.Run(ctx, s.rdb, nil, s.ns, huddleID.String(), participantID.String()).Slice()
	if err != nil {
		return nil, fmt.Errorf("huddle: remove: %w", err)
	}
	raw, ok := res[0].(string)
	if !ok {
		return nil, nil
	}
	p, err := decode(raw)
	if err != nil {
		return nil, err
	}
	version, _ := res[1].(int64)
	remaining, _ := res[2].(int64)
	return &chat.RemovedParticipant{Participant: p, Version: version, Remaining: int(remaining)}, nil
}

// sweepScript は、期限を過ぎた参加を max 件まで外す（決定 5）。
// ARGV = いまの時刻（ミリ秒）, max
// 返り値 = { 参加の JSON, 版, 残りの人数, ... } の繰り返し
var sweepScript = goredis.NewScript(removeLua + `
local expired = redis.call('ZRANGEBYSCORE', NS .. 'huddle_deadlines', '-inf', ARGV[1], 'LIMIT', 0, tonumber(ARGV[2]))
local out = {}
for i = 1, #expired do
  local huddle, participant = string.match(expired[i], '^(%S+)/(%S+)$')
  local json = remove(huddle, participant)
  if json then
    table.insert(out, json)
    table.insert(out, tonumber(redis.call('GET', NS .. 'huddle:' .. huddle .. ':version') or '0'))
    table.insert(out, #redis.call('HKEYS', NS .. 'huddle:' .. huddle .. ':members'))
  else
    redis.call('ZREM', NS .. 'huddle_deadlines', expired[i])
  end
end
return out
`)

// Sweep は、心拍の期限が now を過ぎた参加を最大 max 件外して返す（決定 5）。
func (s *Store) Sweep(ctx context.Context, now time.Time, max int) ([]chat.RemovedParticipant, error) {
	res, err := sweepScript.Run(ctx, s.rdb, nil, s.ns, millis(now), max).Slice()
	if err != nil {
		return nil, fmt.Errorf("huddle: sweep: %w", err)
	}
	out := make([]chat.RemovedParticipant, 0, len(res)/3)
	for i := 0; i+2 < len(res); i += 3 {
		raw, _ := res[i].(string)
		p, err := decode(raw)
		if err != nil {
			return nil, err
		}
		version, _ := res[i+1].(int64)
		remaining, _ := res[i+2].(int64)
		out = append(out, chat.RemovedParticipant{Participant: p, Version: version, Remaining: int(remaining)})
	}
	return out, nil
}

// setMutedScript はミュートを書き換える（決定 10）。参加がなければ 0 を返す。
// ARGV = huddleID, participantID, "1" か "0"
var setMutedScript = goredis.NewScript(`
local NS = table.remove(ARGV, 1)
local members = NS .. 'huddle:' .. ARGV[1] .. ':members'
local json = redis.call('HGET', members, ARGV[2])
if not json then
  return 0
end
local p = cjson.decode(json)
p['muted'] = ARGV[3] == '1'
redis.call('HSET', members, ARGV[2], cjson.encode(p))
return redis.call('INCR', NS .. 'huddle:' .. ARGV[1] .. ':version')
`)

// SetMuted はミュートを書き換え、新しい版を返す。参加がなければ ok は false。
func (s *Store) SetMuted(ctx context.Context, huddleID, participantID ulid.ULID, muted bool) (version int64, ok bool, err error) {
	flag := "0"
	if muted {
		flag = "1"
	}
	v, err := setMutedScript.Run(ctx, s.rdb, nil, s.ns, huddleID.String(), participantID.String(), flag).Int64()
	if err != nil {
		return 0, false, fmt.Errorf("huddle: set muted: %w", err)
	}
	return v, v > 0, nil
}

// joiningSoonScript は「もうすぐ参加する」を書く（決定 11）。期限の過ぎたものは消す（読むときも期限で絞る）。
// ARGV = huddleID, userID, 期限（ミリ秒）, いまの時刻（ミリ秒）
var joiningSoonScript = goredis.NewScript(`
local NS = table.remove(ARGV, 1)
local soon = NS .. 'huddle:' .. ARGV[1] .. ':soon'
redis.call('ZADD', soon, ARGV[3], ARGV[2])
redis.call('ZREMRANGEBYSCORE', soon, '-inf', ARGV[4])
redis.call('PEXPIRE', soon, 86400000)
return redis.call('INCR', NS .. 'huddle:' .. ARGV[1] .. ':version')
`)

// JoiningSoon は userID が「もうすぐ参加する」を押したことを until まで残し、新しい版を返す。
func (s *Store) JoiningSoon(ctx context.Context, huddleID, userID ulid.ULID, until, now time.Time) (int64, error) {
	v, err := joiningSoonScript.Run(ctx, s.rdb, nil, s.ns, huddleID.String(), userID.String(), millis(until), millis(now)).Int64()
	if err != nil {
		return 0, fmt.Errorf("huddle: joining soon: %w", err)
	}
	return v, nil
}

// clearScript は、ハドルの全員を外して、ハドルのキーを消す（終わった。決定 7・8）。外した参加の JSON を返す。
// ARGV = huddleID
var clearScript = goredis.NewScript(removeLua + `
local members = NS .. 'huddle:' .. ARGV[1] .. ':members'
local out = {}
for _, participant in ipairs(redis.call('HKEYS', members)) do
  local json = remove(ARGV[1], participant)
  if json then
    table.insert(out, json)
  end
end
redis.call('DEL', members, NS .. 'huddle:' .. ARGV[1] .. ':version', NS .. 'huddle:' .. ARGV[1] .. ':soon')
return out
`)

// Clear はハドルの全員を外し、ハドルの状態を消す。外した参加を返す（Cloudflare のトラックを閉じるため）。
func (s *Store) Clear(ctx context.Context, huddleID ulid.ULID) ([]chat.HuddleParticipant, error) {
	res, err := clearScript.Run(ctx, s.rdb, nil, s.ns, huddleID.String()).StringSlice()
	if err != nil {
		return nil, fmt.Errorf("huddle: clear: %w", err)
	}
	out := make([]chat.HuddleParticipant, 0, len(res))
	for _, raw := range res {
		p, err := decode(raw)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, nil
}

// Participant は参加を 1 つ読む。なければ nil。
func (s *Store) Participant(ctx context.Context, huddleID, participantID ulid.ULID) (*chat.HuddleParticipant, error) {
	raw, err := s.rdb.HGet(ctx, s.membersKey(huddleID), participantID.String()).Result()
	if errors.Is(err, goredis.Nil) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("huddle: get participant: %w", err)
	}
	p, err := decode(raw)
	if err != nil {
		return nil, err
	}
	return &p, nil
}

// Current は、その人がいま入っている参加の huddleID と participantID を返す（決定 6）。入っていなければ ok は false。
func (s *Store) Current(ctx context.Context, userID ulid.ULID) (huddleID, participantID ulid.ULID, ok bool, err error) {
	raw, err := s.rdb.Get(ctx, s.userKey(userID)).Result()
	if errors.Is(err, goredis.Nil) {
		return ulid.ULID{}, ulid.ULID{}, false, nil
	}
	if err != nil {
		return ulid.ULID{}, ulid.ULID{}, false, fmt.Errorf("huddle: current: %w", err)
	}
	h, p, found := strings.Cut(raw, " ")
	if !found {
		return ulid.ULID{}, ulid.ULID{}, false, fmt.Errorf("huddle: current: malformed %q", raw)
	}
	if huddleID, err = ulid.Parse(h); err != nil {
		return ulid.ULID{}, ulid.ULID{}, false, fmt.Errorf("huddle: current: %w", err)
	}
	if participantID, err = ulid.Parse(p); err != nil {
		return ulid.ULID{}, ulid.ULID{}, false, fmt.Errorf("huddle: current: %w", err)
	}
	return huddleID, participantID, true, nil
}

// Snapshots は複数のハドルのいまの状態を 1 回の往復で読む（ルームの一覧に添える。決定 13）。
// now より前に期限の切れた「もうすぐ参加する」は含めない。
func (s *Store) Snapshots(ctx context.Context, huddleIDs []ulid.ULID, now time.Time) (map[ulid.ULID]chat.HuddleSnapshot, error) {
	if len(huddleIDs) == 0 {
		return map[ulid.ULID]chat.HuddleSnapshot{}, nil
	}
	type cmds struct {
		members *goredis.MapStringStringCmd
		soon    *goredis.StringSliceCmd
		version *goredis.StringCmd
	}
	all := make([]cmds, len(huddleIDs))
	_, err := s.rdb.Pipelined(ctx, func(p goredis.Pipeliner) error {
		for i, id := range huddleIDs {
			all[i] = cmds{
				members: p.HGetAll(ctx, s.membersKey(id)),
				soon:    p.ZRangeByScore(ctx, s.soonKey(id), &goredis.ZRangeBy{Min: "(" + millis(now), Max: "+inf"}),
				version: p.Get(ctx, s.versionKey(id)),
			}
		}
		return nil
	})
	if err != nil && !errors.Is(err, goredis.Nil) {
		return nil, fmt.Errorf("huddle: snapshots: %w", err)
	}
	out := make(map[ulid.ULID]chat.HuddleSnapshot, len(huddleIDs))
	for i, id := range huddleIDs {
		snap := chat.HuddleSnapshot{HuddleID: id}
		for _, raw := range all[i].members.Val() {
			p, err := decode(raw)
			if err != nil {
				return nil, err
			}
			snap.Participants = append(snap.Participants, p)
		}
		// 入った順に並べる（同時なら参加 ID の順。ULID は時刻の順に並ぶ）
		slices.SortFunc(snap.Participants, func(a, b chat.HuddleParticipant) int {
			if c := a.JoinedAt.Compare(b.JoinedAt); c != 0 {
				return c
			}
			return a.ID.Compare(b.ID)
		})
		joined := make(map[ulid.ULID]bool, len(snap.Participants))
		for _, p := range snap.Participants {
			joined[p.UserID] = true
		}
		for _, raw := range all[i].soon.Val() {
			if u, err := ulid.Parse(raw); err == nil && !joined[u] {
				snap.JoiningSoon = append(snap.JoiningSoon, u)
			}
		}
		snap.Version, _ = strconv.ParseInt(all[i].version.Val(), 10, 64)
		out[id] = snap
	}
	return out, nil
}

// recordICEScript は発行した TURN の認証情報を覚える。期限の過ぎたものは消し、キーには保険の TTL（TURN の上限の 48 時間）を付ける。
// ARGV = username, 期限（ミリ秒）, いまの時刻（ミリ秒）
var recordICEScript = goredis.NewScript(`
redis.call('ZADD', KEYS[1], ARGV[2], ARGV[1])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[3])
redis.call('PEXPIRE', KEYS[1], 172800000)
return 1
`)

// RecordICEUsername は、その人に発行した TURN の認証情報を expiresAt まで覚える。
func (s *Store) RecordICEUsername(ctx context.Context, userID ulid.ULID, username string, expiresAt, now time.Time) error {
	if err := recordICEScript.Run(ctx, s.rdb, []string{s.iceKey(userID)}, username, millis(expiresAt), millis(now)).Err(); err != nil {
		return fmt.Errorf("huddle: record ice username: %w", err)
	}
	return nil
}

// takeICEScript は期限の切れていない認証情報を返して、キーを消す。ARGV = いまの時刻（ミリ秒）
var takeICEScript = goredis.NewScript(`
local names = redis.call('ZRANGEBYSCORE', KEYS[1], '(' .. ARGV[1], '+inf')
redis.call('DEL', KEYS[1])
return names
`)

// TakeICEUsernames は、その人に発行してまだ期限の切れていない認証情報を返して忘れる。
func (s *Store) TakeICEUsernames(ctx context.Context, userID ulid.ULID, now time.Time) ([]string, error) {
	names, err := takeICEScript.Run(ctx, s.rdb, []string{s.iceKey(userID)}, millis(now)).StringSlice()
	if err != nil {
		return nil, fmt.Errorf("huddle: take ice usernames: %w", err)
	}
	return names, nil
}

func (s *Store) count(ctx context.Context, huddleID ulid.ULID) (int, error) {
	keys, err := s.rdb.HKeys(ctx, s.membersKey(huddleID)).Result()
	if err != nil {
		return 0, fmt.Errorf("huddle: count: %w", err)
	}
	return len(keys), nil
}

func decode(raw string) (chat.HuddleParticipant, error) {
	var r record
	if err := json.Unmarshal([]byte(raw), &r); err != nil {
		return chat.HuddleParticipant{}, fmt.Errorf("huddle: decode participant: %w", err)
	}
	return chat.HuddleParticipant(r), nil
}
