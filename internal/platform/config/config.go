// Package config は環境変数から設定を読み込む。
//
// 設定ファイルではなく環境変数にするのは、compose / CI / 本番のどれでも同じ仕組みで渡せるため。
// 必須の値が欠けていたら、起動時に不足をまとめて報告して落とす（動いてから壊れるより早く気づける）。
package config

import (
	"errors"
	"fmt"
	"log/slog"
	"time"
)

// Config はサーバーの設定。
type Config struct {
	HTTPAddr        string
	DatabaseURL     string
	RedisURL        string
	LogLevel        slog.Level
	LogFormat       LogFormat
	ShutdownTimeout time.Duration
}

// LogFormat はログの出力形式。
type LogFormat string

const (
	LogFormatJSON LogFormat = "json"
	LogFormatText LogFormat = "text"
)

// LookupEnv は os.LookupEnv と同じシグネチャ。テストでプロセスの環境変数を書き換えずに済むよう注入する。
type LookupEnv func(key string) (string, bool)

// Load は環境変数から Config を作る。
func Load(lookup LookupEnv) (Config, error) {
	var errs []error

	required := func(key string) string {
		v, ok := lookup(key)
		if !ok || v == "" {
			errs = append(errs, fmt.Errorf("%s is required", key))
		}
		return v
	}
	optional := func(key, def string) string {
		if v, ok := lookup(key); ok && v != "" {
			return v
		}
		return def
	}

	cfg := Config{
		HTTPAddr:    optional("HTTP_ADDR", ":8080"),
		DatabaseURL: required("DATABASE_URL"),
		RedisURL:    required("REDIS_URL"),
	}

	if err := cfg.LogLevel.UnmarshalText([]byte(optional("LOG_LEVEL", "info"))); err != nil {
		errs = append(errs, fmt.Errorf("LOG_LEVEL: %w", err))
	}

	switch f := LogFormat(optional("LOG_FORMAT", string(LogFormatJSON))); f {
	case LogFormatJSON, LogFormatText:
		cfg.LogFormat = f
	default:
		errs = append(errs, fmt.Errorf("LOG_FORMAT: must be %q or %q, got %q", LogFormatJSON, LogFormatText, f))
	}

	timeout, err := time.ParseDuration(optional("SHUTDOWN_TIMEOUT", "15s"))
	switch {
	case err != nil:
		errs = append(errs, fmt.Errorf("SHUTDOWN_TIMEOUT: %w", err))
	case timeout <= 0:
		errs = append(errs, fmt.Errorf("SHUTDOWN_TIMEOUT: must be positive, got %s", timeout))
	default:
		cfg.ShutdownTimeout = timeout
	}

	if len(errs) > 0 {
		return Config{}, fmt.Errorf("load config: %w", errors.Join(errs...))
	}
	return cfg, nil
}
