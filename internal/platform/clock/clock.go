// Package clock は現在時刻の取得を抽象化する。
//
// time.Now() を直接呼ぶと、期限切れ・TTL・掃除ジョブなど時刻に依存する処理を
// テストで決定的に再現できない（time.Sleep で待つことになる）。
// そのため時刻は必ず Clock から取得し、テストでは Fake を注入する。
package clock

import (
	"sync"
	"time"
)

// Clock は現在時刻を返す。
type Clock interface {
	Now() time.Time
}

// System は実際の時刻を返す。time.Now() を呼んでよいのはここだけ。
type System struct{}

// Now は現在時刻を返す。
func (System) Now() time.Time {
	return time.Now() //nolint:forbidigo // Clock の実装そのもの。
}

// Fake はテスト用の Clock。明示的に進めない限り時刻は変わらない。
// 並行テストから Advance と Now が同時に呼ばれても安全にする。
type Fake struct {
	mu  sync.Mutex
	now time.Time
}

// NewFake は t を現在時刻とする Fake を返す。
func NewFake(t time.Time) *Fake {
	return &Fake{now: t}
}

// Now は Fake の現在時刻を返す。
func (f *Fake) Now() time.Time {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.now
}

// Advance は現在時刻を d だけ進める。
func (f *Fake) Advance(d time.Duration) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.now = f.now.Add(d)
}
