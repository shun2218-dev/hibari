package redis_test

import (
	"testing"

	"github.com/shun2218-dev/hibari/internal/platform/redis"
	"github.com/shun2218-dev/hibari/internal/platform/testenv"
)

func TestOpen(t *testing.T) {
	tests := []struct {
		name    string
		url     func(t *testing.T) string
		wantErr bool
	}{
		{name: "reachable", url: func(t *testing.T) string { return testenv.RedisURL(t) }},
		{name: "malformed url", url: func(*testing.T) string { return "http://not-redis" }, wantErr: true},
		{name: "unreachable", url: func(*testing.T) string { return "redis://127.0.0.1:1/0?dial_timeout=1s" }, wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client, err := redis.Open(t.Context(), tt.url(t))
			if tt.wantErr {
				if err == nil {
					_ = client.Close()
					t.Fatal("expected error")
				}
				return
			}
			if err != nil {
				t.Fatalf("Open: %v", err)
			}
			_ = client.Close()
		})
	}
}
