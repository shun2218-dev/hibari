package log_test

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"strings"
	"testing"

	"github.com/shun2218-dev/hibari/internal/platform/config"
	"github.com/shun2218-dev/hibari/internal/platform/log"
)

func TestNewJSON(t *testing.T) {
	var buf bytes.Buffer
	logger := log.New(&buf, slog.LevelInfo, config.LogFormatJSON)

	logger.Debug("hidden")
	logger.Info("hello", slog.String("request_id", "r1"))

	lines := strings.Split(strings.TrimSpace(buf.String()), "\n")
	if len(lines) != 1 {
		t.Fatalf("got %d lines, want 1 (debug は出力されないはず): %q", len(lines), buf.String())
	}
	var rec map[string]any
	if err := json.Unmarshal([]byte(lines[0]), &rec); err != nil {
		t.Fatalf("output is not JSON: %v", err)
	}
	if rec["msg"] != "hello" || rec["request_id"] != "r1" {
		t.Fatalf("unexpected record: %v", rec)
	}
}

func TestNewText(t *testing.T) {
	var buf bytes.Buffer
	logger := log.New(&buf, slog.LevelDebug, config.LogFormatText)

	logger.Debug("hello", slog.String("room_id", "x"))

	if out := buf.String(); !strings.Contains(out, "msg=hello") || !strings.Contains(out, "room_id=x") {
		t.Fatalf("unexpected text output: %q", out)
	}
}
