package clock_test

import (
	"sync"
	"testing"
	"time"

	"github.com/shun2218-dev/hibari/internal/platform/clock"
)

func TestFake(t *testing.T) {
	start := time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC)
	c := clock.NewFake(start)

	if got := c.Now(); !got.Equal(start) {
		t.Fatalf("Now() = %v, want %v", got, start)
	}

	c.Advance(90 * time.Second)
	if got, want := c.Now(), start.Add(90*time.Second); !got.Equal(want) {
		t.Fatalf("after Advance: Now() = %v, want %v", got, want)
	}
}

func TestFakeConcurrentAdvance(t *testing.T) {
	start := time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC)
	c := clock.NewFake(start)

	const n = 100
	var wg sync.WaitGroup
	for range n {
		wg.Go(func() {
			c.Advance(time.Second)
			_ = c.Now()
		})
	}
	wg.Wait()

	if got, want := c.Now(), start.Add(n*time.Second); !got.Equal(want) {
		t.Fatalf("Now() = %v, want %v", got, want)
	}
}
