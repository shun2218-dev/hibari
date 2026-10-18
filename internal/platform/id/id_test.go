package id_test

import (
	"bytes"
	"crypto/rand"
	"sync"
	"testing"
	"time"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/platform/clock"
	"github.com/shun2218-dev/hibari/internal/platform/id"
)

func TestGeneratorUsesClock(t *testing.T) {
	now := time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC)
	g := id.NewGenerator(clock.NewFake(now), rand.Reader)

	got := g.New()
	if got.Time() != ulid.Timestamp(now) {
		t.Fatalf("ULID timestamp = %d, want %d", got.Time(), ulid.Timestamp(now))
	}
}

func TestGeneratorIsDeterministic(t *testing.T) {
	now := time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC)
	seed := bytes.Repeat([]byte{0x42}, 1024)

	a := id.NewGenerator(clock.NewFake(now), bytes.NewReader(seed))
	b := id.NewGenerator(clock.NewFake(now), bytes.NewReader(seed))

	for i := range 3 {
		if x, y := a.New(), b.New(); x != y {
			t.Fatalf("#%d: %s != %s（同じ Clock と乱数源なら同じ ID になるはず）", i, x, y)
		}
	}
}

func TestGeneratorMonotonicWithinSameMillisecond(t *testing.T) {
	g := id.NewGenerator(clock.NewFake(time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC)), rand.Reader)

	prev := g.New()
	for range 1000 {
		next := g.New()
		if next.Compare(prev) <= 0 {
			t.Fatalf("not monotonic: %s <= %s", next, prev)
		}
		prev = next
	}
}

func TestGeneratorConcurrentUnique(t *testing.T) {
	g := id.NewGenerator(clock.NewFake(time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC)), rand.Reader)

	const workers, perWorker = 50, 200
	var (
		mu   sync.Mutex
		seen = make(map[ulid.ULID]struct{}, workers*perWorker)
		wg   sync.WaitGroup
	)
	for range workers {
		wg.Go(func() {
			local := make([]ulid.ULID, 0, perWorker)
			for range perWorker {
				local = append(local, g.New())
			}
			mu.Lock()
			defer mu.Unlock()
			for _, v := range local {
				seen[v] = struct{}{}
			}
		})
	}
	wg.Wait()

	if len(seen) != workers*perWorker {
		t.Fatalf("unique IDs = %d, want %d", len(seen), workers*perWorker)
	}
}
