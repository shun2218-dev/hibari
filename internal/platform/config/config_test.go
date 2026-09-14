package config_test

import (
	"log/slog"
	"net/netip"
	"net/url"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/shun2218-dev/hibari/internal/platform/config"
	"github.com/shun2218-dev/hibari/internal/platform/storage"
)

func env(m map[string]string) config.LookupEnv {
	return func(key string) (string, bool) {
		v, ok := m[key]
		return v, ok
	}
}

func TestLoad(t *testing.T) {
	base := map[string]string{
		"DATABASE_URL": "postgres://localhost/hibari",
		"REDIS_URL":    "redis://localhost:6379/0",

		"JWT_PRIVATE_KEY_FILE": "/keys/jwt.pem",

		"S3_ENDPOINT":          "http://minio:9000",
		"S3_BUCKET":            "hibari",
		"S3_ACCESS_KEY_ID":     "id",
		"S3_SECRET_ACCESS_KEY": "secret",
	}
	with := func(kv ...string) map[string]string {
		m := make(map[string]string, len(base)+len(kv)/2)
		for k, v := range base {
			m[k] = v
		}
		for i := 0; i < len(kv); i += 2 {
			m[kv[i]] = kv[i+1]
		}
		return m
	}

	tests := []struct {
		name    string
		env     map[string]string
		want    config.Config
		wantErr []string // エラーメッセージに含まれるべき部分文字列
	}{
		{
			name: "defaults",
			env:  base,
			want: config.Config{
				HTTPAddr:        ":8080",
				DatabaseURL:     "postgres://localhost/hibari",
				RedisURL:        "redis://localhost:6379/0",
				LogLevel:        slog.LevelInfo,
				LogFormat:       config.LogFormatJSON,
				ShutdownTimeout: 15 * time.Second,

				JWTPrivateKeyFile:   "/keys/jwt.pem",
				JWTIssuer:           "hibari",
				JWTAudience:         "hibari-api",
				RefreshCookieSecure: true,
				AppBaseURL:          &url.URL{Scheme: "http", Host: "localhost:3000"},

				Storage:                storage.Config{Endpoint: "http://minio:9000", Region: "us-east-1", Bucket: "hibari", AccessKeyID: "id", SecretAccessKey: "secret"},
				AttachmentMaxBytes:     25 << 20,
				AttachmentAllowedTypes: config.DefaultAttachmentAllowedTypes,
			},
		},
		{
			name: "overrides",
			env: with("HTTP_ADDR", ":9090", "LOG_LEVEL", "debug", "LOG_FORMAT", "text", "SHUTDOWN_TIMEOUT", "3s",
				"JWT_ISSUER", "https://hibari.example", "JWT_AUDIENCE", "chat", "REFRESH_COOKIE_SECURE", "false",
				"APP_BASE_URL", "https://hibari.example/app",
				"S3_PUBLIC_ENDPOINT", "http://localhost:9000", "S3_REGION", "auto", "S3_USE_PATH_STYLE", "true",
				"ATTACHMENT_MAX_BYTES", "1048576", "ATTACHMENT_ALLOWED_TYPES", "image/png, application/octet-stream",
				"TRUSTED_PROXIES", "172.16.0.0/12, fdaa::/16,203.0.113.7/32"),
			want: config.Config{
				HTTPAddr:        ":9090",
				DatabaseURL:     "postgres://localhost/hibari",
				RedisURL:        "redis://localhost:6379/0",
				LogLevel:        slog.LevelDebug,
				LogFormat:       config.LogFormatText,
				ShutdownTimeout: 3 * time.Second,

				JWTPrivateKeyFile:   "/keys/jwt.pem",
				JWTIssuer:           "https://hibari.example",
				JWTAudience:         "chat",
				RefreshCookieSecure: false,
				AppBaseURL:          &url.URL{Scheme: "https", Host: "hibari.example", Path: "/app"},
				TrustedProxies: []netip.Prefix{
					netip.MustParsePrefix("172.16.0.0/12"), netip.MustParsePrefix("fdaa::/16"), netip.MustParsePrefix("203.0.113.7/32"),
				},

				Storage: storage.Config{
					Endpoint: "http://minio:9000", PublicEndpoint: "http://localhost:9000", Region: "auto", Bucket: "hibari",
					AccessKeyID: "id", SecretAccessKey: "secret", UsePathStyle: true,
				},
				AttachmentMaxBytes:     1 << 20,
				AttachmentAllowedTypes: []string{"image/png", "application/octet-stream"},
			},
		},
		{
			name: "missing required values are all reported",
			env:  map[string]string{"DATABASE_URL": ""},
			wantErr: []string{"DATABASE_URL is required", "REDIS_URL is required", "JWT_PRIVATE_KEY_FILE is required",
				"S3_ENDPOINT is required", "S3_BUCKET is required", "S3_ACCESS_KEY_ID is required", "S3_SECRET_ACCESS_KEY is required"},
		},
		{
			name:    "invalid path style",
			env:     with("S3_USE_PATH_STYLE", "maybe"),
			wantErr: []string{"S3_USE_PATH_STYLE"},
		},
		{
			name:    "non-positive attachment max bytes",
			env:     with("ATTACHMENT_MAX_BYTES", "0"),
			wantErr: []string{"ATTACHMENT_MAX_BYTES: must be positive"},
		},
		{
			name:    "invalid attachment max bytes",
			env:     with("ATTACHMENT_MAX_BYTES", "25MB"),
			wantErr: []string{"ATTACHMENT_MAX_BYTES"},
		},
		{
			name:    "attachment types with parameters or upper case",
			env:     with("ATTACHMENT_ALLOWED_TYPES", "text/plain; charset=utf-8,Image/PNG,pdf"),
			wantErr: []string{`"text/plain; charset=utf-8"`, `"Image/PNG"`, `"pdf"`},
		},
		{
			name:    "invalid log level",
			env:     with("LOG_LEVEL", "loud"),
			wantErr: []string{"LOG_LEVEL"},
		},
		{
			name:    "invalid log format",
			env:     with("LOG_FORMAT", "xml"),
			wantErr: []string{"LOG_FORMAT"},
		},
		{
			name:    "invalid shutdown timeout",
			env:     with("SHUTDOWN_TIMEOUT", "soon"),
			wantErr: []string{"SHUTDOWN_TIMEOUT"},
		},
		{
			name:    "invalid refresh cookie secure",
			env:     with("REFRESH_COOKIE_SECURE", "sometimes"),
			wantErr: []string{"REFRESH_COOKIE_SECURE"},
		},
		{
			name:    "relative app base url",
			env:     with("APP_BASE_URL", "/app"),
			wantErr: []string{"APP_BASE_URL: must be an absolute http(s) URL"},
		},
		{
			// 単独のアドレスや、ホスト部の残った CIDR は、意図した範囲か分からないので受け付けない。
			name:    "invalid trusted proxies",
			env:     with("TRUSTED_PROXIES", "10.0.0.1,10.0.0.1/8,caddy"),
			wantErr: []string{`"10.0.0.1"`, `"10.0.0.1/8"`, `"caddy"`},
		},
		{
			name:    "non-positive shutdown timeout",
			env:     with("SHUTDOWN_TIMEOUT", "0s"),
			wantErr: []string{"SHUTDOWN_TIMEOUT: must be positive"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := config.Load(env(tt.env))

			if len(tt.wantErr) > 0 {
				if err == nil {
					t.Fatalf("Load() error = nil, want error containing %q", tt.wantErr)
				}
				for _, s := range tt.wantErr {
					if !strings.Contains(err.Error(), s) {
						t.Errorf("Load() error = %q, want it to contain %q", err, s)
					}
				}
				return
			}
			if err != nil {
				t.Fatalf("Load() error = %v", err)
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("Load() = %+v, want %+v", got, tt.want)
			}
		})
	}
}
