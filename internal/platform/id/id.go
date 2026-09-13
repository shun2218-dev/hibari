// Package id は ULID を生成する（ADR 0005）。
//
// ID を DB の既定値ではなくアプリで生成するのは、INSERT の前に ID を確定させたいことと、
// Clock と乱数源を差し替えてテストで ID を決定的にしたいため。
package id

import (
	"io"
	"sync"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/platform/clock"
)

// Generator は新しい ULID を返す。
type Generator interface {
	New() ulid.ULID
}

// ULIDGenerator は Clock の時刻と乱数源から ULID を作る。
type ULIDGenerator struct {
	clock clock.Clock

	// ulid.MonotonicEntropy は並行に使えないので mu で保護する。
	// 同じミリ秒内で単調増加にしておくと、B-tree への挿入が末尾に寄る（ADR 0005）。
	// ただしインスタンスをまたぐと単調性は保証されないので、順序の根拠には使わない（順序は seq）。
	mu      sync.Mutex
	entropy *ulid.MonotonicEntropy
}

// NewGenerator は ULIDGenerator を返す。本番では entropy に crypto/rand.Reader を渡す。
func NewGenerator(c clock.Clock, entropy io.Reader) *ULIDGenerator {
	return &ULIDGenerator{
		clock:   c,
		entropy: ulid.Monotonic(entropy, 0),
	}
}

// New は新しい ULID を返す。
func (g *ULIDGenerator) New() ulid.ULID {
	g.mu.Lock()
	defer g.mu.Unlock()
	// エラーになるのは、乱数源が読めないときか、同じミリ秒内に 2^80 個近く生成したときだけ。
	// どちらもリクエスト処理で回復できるものではないので、バグとして panic させる。
	return ulid.MustNew(ulid.Timestamp(g.clock.Now()), g.entropy)
}
