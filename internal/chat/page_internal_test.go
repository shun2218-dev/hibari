package chat

import "testing"

func TestPageRequestLimit(t *testing.T) {
	for _, tt := range []struct{ in, want int }{
		{0, DefaultPageLimit},
		{-1, DefaultPageLimit},
		{1, 1},
		{MaxPageLimit, MaxPageLimit},
		{MaxPageLimit + 1, MaxPageLimit},
		{1 << 30, MaxPageLimit},
	} {
		if got := (PageRequest{Limit: tt.in}).limit(); got != tt.want {
			t.Errorf("limit(%d) = %d, want %d", tt.in, got, tt.want)
		}
	}
}
