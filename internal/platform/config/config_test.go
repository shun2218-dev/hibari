package config_test

import (
	"log/slog"
	"maps"
	netmail "net/mail"
	"net/netip"
	"net/url"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/shun2218-dev/hibari/internal/platform/config"
	"github.com/shun2218-dev/hibari/internal/platform/mail"
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

		"MAIL_TRANSPORT": "log",

		"S3_ENDPOINT":          "http://s3:9000",
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
				Mail:                config.MailConfig{Transport: config.MailTransportLog},
				// 既定は検証を求める（ADR 0053 決定 4）。
				RequireVerifiedEmail: true,

				Storage:                storage.Config{Endpoint: "http://s3:9000", Region: "us-east-1", Bucket: "hibari", AccessKeyID: "id", SecretAccessKey: "secret"},
				AttachmentMaxBytes:     25 << 20,
				AttachmentAllowedTypes: config.DefaultAttachmentAllowedTypes,
				AvatarMaxBytes:         2 << 20,
				AvatarAllowedTypes:     config.DefaultAvatarAllowedTypes,
			},
		},
		{
			name: "overrides",
			env: with("HTTP_ADDR", ":9090", "LOG_LEVEL", "debug", "LOG_FORMAT", "text", "SHUTDOWN_TIMEOUT", "3s",
				"JWT_ISSUER", "https://hibari.example", "JWT_AUDIENCE", "chat", "REFRESH_COOKIE_SECURE", "false",
				"APP_BASE_URL", "https://hibari.example/app",
				"S3_PUBLIC_ENDPOINT", "http://localhost:9000", "S3_REGION", "auto", "S3_USE_PATH_STYLE", "true",
				"ATTACHMENT_MAX_BYTES", "1048576", "ATTACHMENT_ALLOWED_TYPES", "image/png, application/octet-stream",
				"TRUSTED_PROXIES", "172.16.0.0/12, fdaa::/16,203.0.113.7/32", "AUTH_REQUIRE_VERIFIED_EMAIL", "false"),
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
				Mail: config.MailConfig{Transport: config.MailTransportLog},
				// MAIL_TRANSPORT=log なので外せる。
				RequireVerifiedEmail: false,

				Storage: storage.Config{
					Endpoint: "http://s3:9000", PublicEndpoint: "http://localhost:9000", Region: "auto", Bucket: "hibari",
					AccessKeyID: "id", SecretAccessKey: "secret", UsePathStyle: true,
				},
				AttachmentMaxBytes:     1 << 20,
				AttachmentAllowedTypes: []string{"image/png", "application/octet-stream"},
				AvatarMaxBytes:         config.DefaultAvatarMaxBytes,
				AvatarAllowedTypes:     config.DefaultAvatarAllowedTypes,
			},
		},
		{
			name: "missing required values are all reported",
			env:  map[string]string{"DATABASE_URL": ""},
			wantErr: []string{"DATABASE_URL is required", "REDIS_URL is required", "JWT_PRIVATE_KEY_FILE is required",
				"MAIL_TRANSPORT is required", "S3_ENDPOINT is required", "S3_BUCKET is required", "S3_ACCESS_KEY_ID is required", "S3_SECRET_ACCESS_KEY is required"},
		},
		{
			// 本番で設定を忘れて、黙ってログに出すだけにならないように、既定を置かない（ADR 0053）。
			name:    "mail transport is required",
			env:     with("MAIL_TRANSPORT", ""),
			wantErr: []string{"MAIL_TRANSPORT is required"},
		},
		{
			name:    "unknown mail transport",
			env:     with("MAIL_TRANSPORT", "resend"),
			wantErr: []string{`MAIL_TRANSPORT: must be "log" or "smtp", got "resend"`},
		},
		{
			name: "smtp requires its settings",
			env:  with("MAIL_TRANSPORT", "smtp"),
			wantErr: []string{"SMTP_HOST is required", "SMTP_PORT is required", "SMTP_USERNAME is required",
				"SMTP_PASSWORD_FILE is required", "MAIL_FROM is required"},
		},
		{
			name:    "invalid smtp port and from",
			env:     with("MAIL_TRANSPORT", "smtp", "SMTP_HOST", "smtp.resend.com", "SMTP_PORT", "smtps", "SMTP_USERNAME", "resend", "SMTP_PASSWORD_FILE", "/run/secrets/smtp", "MAIL_FROM", "hibari"),
			wantErr: []string{`SMTP_PORT: must be a port number, got "smtps"`, "MAIL_FROM"},
		},
		{
			name:    "invalid require verified email",
			env:     with("AUTH_REQUIRE_VERIFIED_EMAIL", "no"),
			wantErr: []string{"AUTH_REQUIRE_VERIFIED_EMAIL"},
		},
		{
			// メールが本当に届く設定で検証を外すと、本番で誤って外れたまま動くので起動しない（ADR 0053 決定 4）。
			name: "verified email cannot be skipped with smtp",
			env: with("MAIL_TRANSPORT", "smtp", "SMTP_HOST", "smtp.resend.com", "SMTP_PORT", "465", "SMTP_USERNAME", "resend",
				"SMTP_PASSWORD_FILE", "/run/secrets/smtp", "MAIL_FROM", "noreply@mail.example.com", "AUTH_REQUIRE_VERIFIED_EMAIL", "false"),
			wantErr: []string{`AUTH_REQUIRE_VERIFIED_EMAIL: cannot be false when MAIL_TRANSPORT is "smtp"`},
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
			name:    "non-positive avatar max bytes",
			env:     with("AVATAR_MAX_BYTES", "0"),
			wantErr: []string{"AVATAR_MAX_BYTES: must be positive"},
		},
		{
			name:    "avatar types with parameters",
			env:     with("AVATAR_ALLOWED_TYPES", "image/png; charset=utf-8,svg"),
			wantErr: []string{`AVATAR_ALLOWED_TYPES: invalid media type "image/png; charset=utf-8"`, `"svg"`},
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

// TLS の方式はポート番号から決める（465 / 2465 は暗黙の TLS、それ以外は STARTTLS）。
func TestLoadSMTP(t *testing.T) {
	for _, tt := range []struct {
		port        string
		wantImplied bool
	}{{"465", true}, {"587", false}} {
		t.Run(tt.port, func(t *testing.T) {
			port, _ := strconv.Atoi(tt.port)
			got, err := config.Load(env(map[string]string{
				"DATABASE_URL": "postgres://localhost/hibari", "REDIS_URL": "redis://localhost:6379/0",
				"JWT_PRIVATE_KEY_FILE": "/keys/jwt.pem",
				"S3_ENDPOINT":          "http://s3:9000", "S3_BUCKET": "hibari", "S3_ACCESS_KEY_ID": "id", "S3_SECRET_ACCESS_KEY": "secret",

				"MAIL_TRANSPORT": "smtp", "SMTP_HOST": "smtp.resend.com", "SMTP_PORT": tt.port, "SMTP_USERNAME": "resend",
				"SMTP_PASSWORD_FILE": "/run/secrets/smtp_password", "MAIL_FROM": "hibari <noreply@mail.example.com>",
			}))
			if err != nil {
				t.Fatalf("Load() error = %v", err)
			}
			want := config.MailConfig{
				Transport: config.MailTransportSMTP,
				SMTP: mail.SMTPConfig{
					Host: "smtp.resend.com", Port: port, Username: "resend",
					From:        &netmail.Address{Name: "hibari", Address: "noreply@mail.example.com"},
					ImplicitTLS: tt.wantImplied,
				},
				SMTPPasswordFile: "/run/secrets/smtp_password",
			}
			if !reflect.DeepEqual(got.Mail, want) {
				t.Fatalf("Mail = %+v, want %+v", got.Mail, want)
			}
			if !got.RequireVerifiedEmail {
				t.Fatal("RequireVerifiedEmail = false, want true by default with smtp")
			}
		})
	}
}

// Cloudflare Realtime は 4 つとも揃えばハドルを有効に、どれもなければ無効にする。一部だけなら起動を止める（ADR 0066 決定 15）。
func TestLoadRealtime(t *testing.T) {
	base := map[string]string{
		"DATABASE_URL": "postgres://localhost/hibari", "REDIS_URL": "redis://localhost:6379/0",
		"JWT_PRIVATE_KEY_FILE": "/keys/jwt.pem", "MAIL_TRANSPORT": "log",
		"S3_ENDPOINT": "http://s3:9000", "S3_BUCKET": "hibari", "S3_ACCESS_KEY_ID": "id", "S3_SECRET_ACCESS_KEY": "secret",
	}
	all := map[string]string{
		"CLOUDFLARE_REALTIME_APP_ID":          "app-1",
		"CLOUDFLARE_REALTIME_APP_SECRET_FILE": "/keys/cloudflare_realtime_app_secret",
		"CLOUDFLARE_TURN_KEY_ID":              "key-1",
		"CLOUDFLARE_TURN_KEY_API_TOKEN_FILE":  "/keys/cloudflare_turn_api_token",
	}
	merged := func(extra map[string]string) map[string]string {
		m := maps.Clone(base)
		maps.Copy(m, extra)
		return m
	}

	t.Run("none disables huddles", func(t *testing.T) {
		got, err := config.Load(env(base))
		if err != nil {
			t.Fatal(err)
		}
		if got.Realtime != (config.RealtimeConfig{}) {
			t.Errorf("Realtime = %+v", got.Realtime)
		}
	})

	t.Run("all enables huddles", func(t *testing.T) {
		got, err := config.Load(env(merged(all)))
		if err != nil {
			t.Fatal(err)
		}
		want := config.RealtimeConfig{
			Enabled: true, AppID: "app-1", AppSecretFile: "/keys/cloudflare_realtime_app_secret",
			TURNKeyID: "key-1", TURNKeyAPITokenFile: "/keys/cloudflare_turn_api_token",
		}
		if got.Realtime != want {
			t.Errorf("Realtime = %+v", got.Realtime)
		}
	})

	for key := range all {
		t.Run("missing "+key, func(t *testing.T) {
			partial := maps.Clone(all)
			delete(partial, key)

			_, err := config.Load(env(merged(partial)))
			if err == nil || !strings.Contains(err.Error(), key) {
				t.Errorf("err = %v, want it to name %s", err, key)
			}
		})
	}

	// relay だけにするのは、開発で TURN を通る経路を確かめるため。既定は all（直接つながるならそちらを使う）。
	policies := []struct {
		value   string
		want    bool
		wantErr bool
	}{
		{"", false, false},
		{"all", false, false},
		{"relay", true, false},
		{"RELAY", false, true},
		{"none", false, true},
	}
	for _, tt := range policies {
		t.Run("ice transport policy "+tt.value, func(t *testing.T) {
			extra := maps.Clone(all)
			if tt.value != "" {
				extra["HUDDLE_ICE_TRANSPORT_POLICY"] = tt.value
			}
			got, err := config.Load(env(merged(extra)))
			if tt.wantErr {
				if err == nil || !strings.Contains(err.Error(), "HUDDLE_ICE_TRANSPORT_POLICY") {
					t.Errorf("err = %v, want it to name HUDDLE_ICE_TRANSPORT_POLICY", err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if got.Realtime.RelayOnly != tt.want {
				t.Errorf("RelayOnly = %v, want %v", got.Realtime.RelayOnly, tt.want)
			}
		})
	}
}
