package config_test

import (
	"log/slog"
	"net/url"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/shun2218-dev/hibari/internal/platform/config"
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
			},
		},
		{
			name: "overrides",
			env: with("HTTP_ADDR", ":9090", "LOG_LEVEL", "debug", "LOG_FORMAT", "text", "SHUTDOWN_TIMEOUT", "3s",
				"JWT_ISSUER", "https://hibari.example", "JWT_AUDIENCE", "chat", "REFRESH_COOKIE_SECURE", "false",
				"APP_BASE_URL", "https://hibari.example/app"),
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
			},
		},
		{
			name:    "missing required values are all reported",
			env:     map[string]string{"DATABASE_URL": ""},
			wantErr: []string{"DATABASE_URL is required", "REDIS_URL is required", "JWT_PRIVATE_KEY_FILE is required"},
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
