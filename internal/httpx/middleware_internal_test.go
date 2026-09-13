package httpx

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/shun2218-dev/hibari/internal/platform/clock"
)

// アクセスログのミドルウェアの下でも、http.ResponseController で元の ResponseWriter の機能に届くこと。
// 届かないと Phase 4 の WebSocket のアップグレード（Hijack）やストリーミング（Flush）が失敗する。
func TestAccessLogKeepsResponseControllerWorking(t *testing.T) {
	clk := clock.NewFake(time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC))
	var flushErr error
	h := withAccessLog(slog.New(slog.DiscardHandler), clk,
		http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			flushErr = http.NewResponseController(w).Flush()
		}))

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

	if flushErr != nil {
		t.Fatalf("Flush through middleware: %v", flushErr)
	}
	if !rec.Flushed {
		t.Fatal("underlying ResponseWriter was not flushed")
	}
}

func TestAccessLogRecordsDurationFromClock(t *testing.T) {
	clk := clock.NewFake(time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC))
	var logs bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&logs, nil))
	h := withAccessLog(logger, clk, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		clk.Advance(250 * time.Millisecond)
		w.WriteHeader(http.StatusTeapot)
	}))

	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/", nil))

	var entry struct {
		Duration time.Duration `json:"duration"` // slog の JSON はナノ秒の整数で出力する
		Status   int           `json:"status"`
	}
	if err := json.Unmarshal(logs.Bytes(), &entry); err != nil {
		t.Fatalf("log is not JSON: %v", err)
	}
	if entry.Duration != 250*time.Millisecond || entry.Status != http.StatusTeapot {
		t.Fatalf("log = %+v, want duration=250ms status=418", entry)
	}
}
