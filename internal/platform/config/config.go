// Package config は環境変数から設定を読み込む。
//
// 設定ファイルではなく環境変数にするのは、compose / CI / 本番のどれでも同じ仕組みで渡せるため。
// 必須の値が欠けていたら、起動時に不足をまとめて報告して落とす（動いてから壊れるより早く気づける）。
package config

import (
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"strconv"
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

	// JWTPrivateKeyFile は Access Token の署名鍵（Ed25519、PKCS#8 の PEM）のパス。`make keys` で開発用の鍵を作る。
	// 鍵の中身ではなくパスを受け取るのは、本番でシークレットをファイルとしてマウントする形に合わせるため。
	JWTPrivateKeyFile string
	// JWTIssuer / JWTAudience は Access Token の iss / aud。発行と検証で同じ値を使う。
	JWTIssuer   string
	JWTAudience string
	// RefreshCookieSecure は Refresh Token の Cookie に Secure 属性を付けるか。
	// ブラウザは http://localhost を安全なオリジンとして扱うので、ローカルでも既定の true のままでよい。
	RefreshCookieSecure bool
	// AppBaseURL は Web クライアントの URL。確認メールや再設定メールのリンクの起点にする。
	AppBaseURL *url.URL
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

		JWTPrivateKeyFile: required("JWT_PRIVATE_KEY_FILE"),
		JWTIssuer:         optional("JWT_ISSUER", "hibari"),
		JWTAudience:       optional("JWT_AUDIENCE", "hibari-api"),
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

	secure, err := strconv.ParseBool(optional("REFRESH_COOKIE_SECURE", "true"))
	if err != nil {
		errs = append(errs, fmt.Errorf("REFRESH_COOKIE_SECURE: %w", err))
	}
	cfg.RefreshCookieSecure = secure

	baseURL, err := url.Parse(optional("APP_BASE_URL", "http://localhost:3000"))
	switch {
	case err != nil:
		errs = append(errs, fmt.Errorf("APP_BASE_URL: %w", err))
	case (baseURL.Scheme != "http" && baseURL.Scheme != "https") || baseURL.Host == "":
		errs = append(errs, fmt.Errorf("APP_BASE_URL: must be an absolute http(s) URL, got %q", baseURL))
	default:
		cfg.AppBaseURL = baseURL
	}

	if len(errs) > 0 {
		return Config{}, fmt.Errorf("load config: %w", errors.Join(errs...))
	}
	return cfg, nil
}
