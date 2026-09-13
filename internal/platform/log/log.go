// Package log は log/slog のロガーを組み立てる。
//
// 本番は JSON（集約基盤で属性を検索できるように）、手元では text を選べるようにする。
// パスワード・トークン・メッセージ本文・署名付き URL は属性に入れない（CLAUDE.md「ログ」）。
package log

import (
	"io"
	"log/slog"

	"github.com/shun2218-dev/hibari/internal/platform/config"
)

// New は w に出力する slog.Logger を返す。
func New(w io.Writer, level slog.Level, format config.LogFormat) *slog.Logger {
	opts := &slog.HandlerOptions{Level: level}
	var h slog.Handler
	if format == config.LogFormatText {
		h = slog.NewTextHandler(w, opts)
	} else {
		h = slog.NewJSONHandler(w, opts)
	}
	return slog.New(h)
}
