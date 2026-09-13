// Package config は環境変数から設定を読み込む。
//
// 設定ファイルではなく環境変数にするのは、compose / CI / 本番のどれでも同じ仕組みで渡せるため。
// 必須の値が欠けていたら、起動時に不足をまとめて報告して落とす（動いてから壊れるより早く気づける）。
package config

import (
	"errors"
	"fmt"
	"log/slog"
	"mime"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/shun2218-dev/hibari/internal/platform/storage"
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

	// Storage は添付ファイルを置く S3 API のストレージ（ADR 0008 / 0013）。
	Storage storage.Config
	// AttachmentMaxBytes は添付ファイル 1 つのサイズの上限。
	AttachmentMaxBytes int64
	// AttachmentAllowedTypes は添付ファイルとして受け付ける Content-Type。
	// 種類の分からないファイルはクライアントが application/octet-stream として申告する（ADR 0013）。
	AttachmentAllowedTypes []string
}

// DefaultAttachmentMaxBytes は ATTACHMENT_MAX_BYTES の既定値（25 MiB）。
const DefaultAttachmentMaxBytes = 25 << 20

// DefaultAttachmentAllowedTypes は ATTACHMENT_ALLOWED_TYPES の既定値。
// application/octet-stream を含めて、原則すべてのファイルを添付できるようにする。
// ブラウザで開かせる種類は別に絞っている（chat の inline の判定。ADR 0013）。
var DefaultAttachmentAllowedTypes = []string{
	"image/png", "image/jpeg", "image/gif", "image/webp",
	"application/pdf", "text/plain", "text/csv", "application/json", "application/zip",
	"video/mp4", "audio/mpeg",
	"application/octet-stream",
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

	cfg.Storage = storage.Config{
		Endpoint:        required("S3_ENDPOINT"),
		PublicEndpoint:  optional("S3_PUBLIC_ENDPOINT", ""),
		Region:          optional("S3_REGION", "us-east-1"),
		Bucket:          required("S3_BUCKET"),
		AccessKeyID:     required("S3_ACCESS_KEY_ID"),
		SecretAccessKey: required("S3_SECRET_ACCESS_KEY"),
	}
	pathStyle, err := strconv.ParseBool(optional("S3_USE_PATH_STYLE", "false"))
	if err != nil {
		errs = append(errs, fmt.Errorf("S3_USE_PATH_STYLE: %w", err))
	}
	cfg.Storage.UsePathStyle = pathStyle

	maxBytes, err := strconv.ParseInt(optional("ATTACHMENT_MAX_BYTES", strconv.Itoa(DefaultAttachmentMaxBytes)), 10, 64)
	switch {
	case err != nil:
		errs = append(errs, fmt.Errorf("ATTACHMENT_MAX_BYTES: %w", err))
	case maxBytes <= 0:
		errs = append(errs, fmt.Errorf("ATTACHMENT_MAX_BYTES: must be positive, got %d", maxBytes))
	default:
		cfg.AttachmentMaxBytes = maxBytes
	}

	cfg.AttachmentAllowedTypes = DefaultAttachmentAllowedTypes
	if v := optional("ATTACHMENT_ALLOWED_TYPES", ""); v != "" {
		cfg.AttachmentAllowedTypes = nil
		for t := range strings.SplitSeq(v, ",") {
			t = strings.TrimSpace(t)
			// クライアントの申告と完全一致で比べるので、パラメータのない小文字の type/subtype だけを受け付ける。
			if mt, params, err := mime.ParseMediaType(t); err != nil || len(params) > 0 || mt != t || !strings.Contains(mt, "/") {
				errs = append(errs, fmt.Errorf("ATTACHMENT_ALLOWED_TYPES: invalid media type %q", t))
				continue
			}
			cfg.AttachmentAllowedTypes = append(cfg.AttachmentAllowedTypes, t)
		}
	}

	if len(errs) > 0 {
		return Config{}, fmt.Errorf("load config: %w", errors.Join(errs...))
	}
	return cfg, nil
}
