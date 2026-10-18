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
	netmail "net/mail"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/shun2218-dev/hibari/internal/platform/mail"
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
	// TrustedProxies は X-Forwarded-For を信用する前段のプロキシのアドレス（CIDR）。既定は空で、XFF を読まない（ADR 0017）。
	// ローカルは Caddy、本番は Fly のプロキシになるので、環境ごとに差し替える（docs/deploy.md）。
	TrustedProxies []netip.Prefix

	// Mail は認証のメール（確認と再設定）の送り方（ADR 0053 決定 5）。
	Mail MailConfig
	// RequireVerifiedEmail は、email を検証していない利用者に chat を使わせないか（ADR 0053 決定 1）。
	// 既定は true。false にできるのはメールが本当には届かない設定（MAIL_TRANSPORT=log）のときだけ（決定 4）。
	RequireVerifiedEmail bool

	// Storage は添付ファイルを置く S3 API のストレージ（ADR 0008 / 0013）。
	Storage storage.Config
	// AttachmentMaxBytes は添付ファイル 1 つのサイズの上限。
	AttachmentMaxBytes int64
	// AvatarMaxBytes はアバター画像 1 枚のサイズの上限。
	AvatarMaxBytes int64
	// AvatarAllowedTypes はアバター画像として受け付ける Content-Type。
	AvatarAllowedTypes []string
	// AttachmentAllowedTypes は添付ファイルとして受け付ける Content-Type。
	// 種類の分からないファイルはクライアントが application/octet-stream として申告する（ADR 0013）。
	AttachmentAllowedTypes []string

	// Realtime はハドルに使う Cloudflare Realtime の SFU と TURN（ADR 0066 決定 15）。
	// 設定がなければ Enabled が false で、ハドルだけを無効にして起動する。
	Realtime RealtimeConfig
}

// RealtimeConfig は Cloudflare Realtime の設定。秘密はファイルのパスで受け取り、起動時に読む（JWT の鍵と同じ）。
type RealtimeConfig struct {
	Enabled bool
	// AppID / AppSecretFile は SFU のアプリの ID と秘密のファイル。
	AppID         string
	AppSecretFile string
	// TURNKeyID / TURNKeyAPITokenFile は TURN のキーの ID と API トークンのファイル。
	TURNKeyID           string
	TURNKeyAPITokenFile string
	// RelayOnly が true なら、ブラウザに TURN の中継だけを使わせる（HUDDLE_ICE_TRANSPORT_POLICY=relay）。
	// 開発で、違うネットワークを用意しなくても TURN を通る経路を確かめるためにある。本番では使わない。
	RelayOnly bool
}

// DefaultAttachmentMaxBytes は ATTACHMENT_MAX_BYTES の既定値（25 MiB）。
const DefaultAttachmentMaxBytes = 25 << 20

// DefaultAvatarMaxBytes は AVATAR_MAX_BYTES の既定値（2 MiB）。縮小はクライアントに任せる（ADR 0020）。
const DefaultAvatarMaxBytes = 2 << 20

// DefaultAvatarAllowedTypes は AVATAR_ALLOWED_TYPES の既定値。
// SVG はスクリプトを含められるので入れない（ADR 0013 / 0020）。
var DefaultAvatarAllowedTypes = []string{"image/png", "image/jpeg", "image/webp"}

// DefaultAttachmentAllowedTypes は ATTACHMENT_ALLOWED_TYPES の既定値。
// application/octet-stream を含めて、原則すべてのファイルを添付できるようにする。
// ブラウザで開かせる種類は別に絞っている（chat の inline の判定。ADR 0013）。
var DefaultAttachmentAllowedTypes = []string{
	"image/png", "image/jpeg", "image/gif", "image/webp",
	"application/pdf", "text/plain", "text/csv", "application/json", "application/zip",
	"video/mp4", "audio/mpeg",
	"application/octet-stream",
}

// MailTransport はメールの送り方。
type MailTransport string

const (
	// MailTransportLog はメールを送らず、リンクをログに出す（開発用）。
	MailTransportLog MailTransport = "log"
	// MailTransportSMTP は SMTP で本当に送る。
	MailTransportSMTP MailTransport = "smtp"
)

// MailConfig はメールの設定。
type MailConfig struct {
	Transport MailTransport
	// SMTP は Transport が smtp のときだけ入る。Password は空のままで、起動時に SMTPPasswordFile から読んで入れる。
	SMTP mail.SMTPConfig
	// SMTPPasswordFile は SMTP のパスワード（業者の API キー）のファイルのパス。
	// JWT の署名鍵と同じく、値ではなくパスを受け取る（本番でシークレットをファイルとしてマウントする形に合わせる）。
	SMTPPasswordFile string
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

	for v := range strings.SplitSeq(optional("TRUSTED_PROXIES", ""), ",") {
		v = strings.TrimSpace(v)
		if v == "" {
			continue
		}
		// 1 つのアドレスも /32 や /128 で書かせる。「10.0.0.1/8」のようなホスト部の残った値は、意図した範囲か分からないので拒否する。
		prefix, err := netip.ParsePrefix(v)
		if err != nil || prefix != prefix.Masked() {
			errs = append(errs, fmt.Errorf("TRUSTED_PROXIES: invalid CIDR %q (write a single address as /32 or /128)", v))
			continue
		}
		cfg.TrustedProxies = append(cfg.TrustedProxies, prefix)
	}

	cfg.Mail = mailVar(&errs, required)

	requireVerified, err := strconv.ParseBool(optional("AUTH_REQUIRE_VERIFIED_EMAIL", "true"))
	switch {
	case err != nil:
		errs = append(errs, fmt.Errorf("AUTH_REQUIRE_VERIFIED_EMAIL: %w", err))
	// 外してよい理由は「メールが届かないので検証できない」ことだけ。メールが届く設定で外すと、
	// 本番で誤って外れたまま動くので、起動させない（ADR 0053 決定 4）。環境の名前ではなく、この理由そのものを条件にする。
	case !requireVerified && cfg.Mail.Transport == MailTransportSMTP:
		errs = append(errs, fmt.Errorf("AUTH_REQUIRE_VERIFIED_EMAIL: cannot be false when MAIL_TRANSPORT is %q", MailTransportSMTP))
	}
	cfg.RequireVerifiedEmail = requireVerified

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

	cfg.AttachmentMaxBytes = maxBytesVar(&errs, optional, "ATTACHMENT_MAX_BYTES", DefaultAttachmentMaxBytes)
	cfg.AttachmentAllowedTypes = mediaTypesVar(&errs, optional, "ATTACHMENT_ALLOWED_TYPES", DefaultAttachmentAllowedTypes)
	cfg.AvatarMaxBytes = maxBytesVar(&errs, optional, "AVATAR_MAX_BYTES", DefaultAvatarMaxBytes)
	cfg.AvatarAllowedTypes = mediaTypesVar(&errs, optional, "AVATAR_ALLOWED_TYPES", DefaultAvatarAllowedTypes)

	cfg.Realtime = realtimeVar(&errs, optional)

	if len(errs) > 0 {
		return Config{}, fmt.Errorf("load config: %w", errors.Join(errs...))
	}
	return cfg, nil
}

// realtimeVars は Cloudflare Realtime の 4 つの環境変数（ADR 0066 決定 15）。
var realtimeVars = []string{
	"CLOUDFLARE_REALTIME_APP_ID",
	"CLOUDFLARE_REALTIME_APP_SECRET_FILE",
	"CLOUDFLARE_TURN_KEY_ID",
	"CLOUDFLARE_TURN_KEY_API_TOKEN_FILE",
}

// realtimeVar は Cloudflare Realtime の設定を読む。
//
// 4 つとも空ならハドルを無効にする。Cloudflare のアカウントがなくても、開発やテストができるようにするため（ローカルで動く版がない）。
// 一部だけ設定されているのは設定の誤りなので、黙って無効にせず起動を止める。本番で 1 つ書き忘れて、ハドルが消えたことに気づかないのを防ぐ。
func realtimeVar(errs *[]error, optional func(string, string) string) RealtimeConfig {
	values := make([]string, len(realtimeVars))
	var set, missing []string
	for i, key := range realtimeVars {
		values[i] = optional(key, "")
		if values[i] == "" {
			missing = append(missing, key)
		} else {
			set = append(set, key)
		}
	}
	if len(set) == 0 {
		return RealtimeConfig{}
	}
	if len(missing) > 0 {
		*errs = append(*errs, fmt.Errorf("%s: required when %s is set (set all four to enable huddles, or none to disable them)",
			strings.Join(missing, ", "), strings.Join(set, ", ")))
		return RealtimeConfig{}
	}
	relayOnly := false
	switch p := optional("HUDDLE_ICE_TRANSPORT_POLICY", "all"); p {
	case "all":
	case "relay":
		relayOnly = true
	default:
		// 名前と値は RTCConfiguration の iceTransportPolicy に合わせた。読む人が WebRTC の資料をそのまま引けるように。
		*errs = append(*errs, fmt.Errorf("HUDDLE_ICE_TRANSPORT_POLICY: must be all or relay, got %q", p))
	}
	return RealtimeConfig{
		Enabled:             true,
		AppID:               values[0],
		AppSecretFile:       values[1],
		TURNKeyID:           values[2],
		TURNKeyAPITokenFile: values[3],
		RelayOnly:           relayOnly,
	}
}

// mailVar はメールの設定を読む。
//
// MAIL_TRANSPORT に既定を置かないのは、本番で設定を忘れて、黙ってログに出すだけ（誰にもメールが届かない）になるのを防ぐため（ADR 0053 決定 5）。
func mailVar(errs *[]error, required func(string) string) MailConfig {
	var c MailConfig
	switch t := MailTransport(required("MAIL_TRANSPORT")); t {
	case "":
		return c // required が不足を報告している
	case MailTransportLog:
		c.Transport = t
		return c
	case MailTransportSMTP:
		c.Transport = t
	default:
		*errs = append(*errs, fmt.Errorf("MAIL_TRANSPORT: must be %q or %q, got %q", MailTransportLog, MailTransportSMTP, t))
		return c
	}

	c.SMTP.Host = required("SMTP_HOST")
	c.SMTP.Username = required("SMTP_USERNAME")
	c.SMTPPasswordFile = required("SMTP_PASSWORD_FILE")
	if raw := required("SMTP_PORT"); raw != "" {
		port, err := strconv.Atoi(raw)
		if err != nil || port <= 0 || port > 65535 {
			*errs = append(*errs, fmt.Errorf("SMTP_PORT: must be a port number, got %q", raw))
		}
		c.SMTP.Port = port
		c.SMTP.ImplicitTLS = mail.ImplicitTLSPort(port)
	}
	if raw := required("MAIL_FROM"); raw != "" {
		from, err := netmail.ParseAddress(raw)
		if err != nil {
			*errs = append(*errs, fmt.Errorf("MAIL_FROM: %w", err))
		}
		c.SMTP.From = from
	}
	return c
}

// maxBytesVar はサイズの上限の環境変数を読む。正の数でなければエラーにする。
func maxBytesVar(errs *[]error, optional func(string, string) string, name string, def int64) int64 {
	v, err := strconv.ParseInt(optional(name, strconv.FormatInt(def, 10)), 10, 64)
	switch {
	case err != nil:
		*errs = append(*errs, fmt.Errorf("%s: %w", name, err))
	case v <= 0:
		*errs = append(*errs, fmt.Errorf("%s: must be positive, got %d", name, v))
	default:
		return v
	}
	return def
}

// mediaTypesVar は Content-Type のコンマ区切りの環境変数を読む。
// クライアントの申告と完全一致で比べるので、パラメータのない小文字の type/subtype だけを受け付ける。
func mediaTypesVar(errs *[]error, optional func(string, string) string, name string, def []string) []string {
	raw := optional(name, "")
	if raw == "" {
		return def
	}
	var types []string
	for t := range strings.SplitSeq(raw, ",") {
		t = strings.TrimSpace(t)
		if mt, params, err := mime.ParseMediaType(t); err != nil || len(params) > 0 || mt != t || !strings.Contains(mt, "/") {
			*errs = append(*errs, fmt.Errorf("%s: invalid media type %q", name, t))
			continue
		}
		types = append(types, t)
	}
	return types
}
