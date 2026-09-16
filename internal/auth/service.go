package auth

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/netip"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/auth/store"
	"github.com/shun2218-dev/hibari/internal/platform/clock"
	"github.com/shun2218-dev/hibari/internal/platform/id"
)

// RefreshTokenTTL は Refresh Token の有効期限。ローテーションのたびに、その時点から数え直す。
const RefreshTokenTTL = 30 * 24 * time.Hour

// refresh_tokens.revoked_reason の値。
const (
	revokedRotated       = "rotated"
	revokedLogout        = "logout"
	revokedReuseDetected = "reuse_detected"
)

// RevocationNotifier はセッションの失効を他のインスタンスや chat に知らせる（authn.RevocationPublisher が実装する）。
type RevocationNotifier interface {
	RevokeSession(ctx context.Context, sid ulid.ULID) error
	RevokeAllSessions(ctx context.Context, userID ulid.ULID) error
}

// Client はトークンを要求したクライアントの情報。監査のために refresh_tokens に残す（設定画面のデバイス一覧にも使う）。
type Client struct {
	UserAgent string
	// IP が無効な値（netip.Addr{}）なら NULL を保存する。
	IP netip.Addr
}

// userAgentMaxBytes は保存する User-Agent の長さの上限。任意の長さのヘッダで DB を膨らませないため。
const userAgentMaxBytes = 512

func (c Client) userAgent() *string {
	if c.UserAgent == "" {
		return nil
	}
	ua := c.UserAgent
	if len(ua) > userAgentMaxBytes {
		// バイト単位で切ると UTF-8 の途中で切れうるので、壊れた末尾を取り除く。
		ua = strings.ToValidUTF8(ua[:userAgentMaxBytes], "")
	}
	return &ua
}

// ipKey は IP 単位の回数制限のキー。IP が分からなければ空文字列（その制限は数えない）。
func (c Client) ipKey() string {
	if !c.IP.IsValid() {
		return ""
	}
	return c.IP.Unmap().String()
}

// accountKey はアカウント単位の回数制限のキー。email は大文字小文字を区別しない（citext）ので揃える。
func accountKey(email string) string {
	if email == "" {
		return ""
	}
	return strings.ToLower(email)
}

func (c Client) ip() *netip.Addr {
	if !c.IP.IsValid() {
		return nil
	}
	ip := c.IP.Unmap()
	return &ip
}

// Session はログイン中の 1 セッション（1 つの Refresh Token のチェーン）に対して発行したトークン。
type Session struct {
	// ID はセッション ID（refresh_tokens.family_id）。Access Token の sid クレームと同じ値（ADR 0007）。
	ID                    ulid.ULID
	AccessToken           string
	AccessTokenExpiresAt  time.Time
	RefreshToken          string
	RefreshTokenExpiresAt time.Time
}

// Deps は Service の依存。
type Deps struct {
	DB           *pgxpool.Pool
	Clock        clock.Clock
	IDs          id.Generator
	Random       io.Reader
	Passwords    *PasswordHasher
	AccessTokens *AccessTokenIssuer
	Revocations  RevocationNotifier
	Limiter      RateLimiter
	Limits       RateLimits
	Storage      Storage
	AvatarLimits AvatarLimits
	Mailer       Mailer
	// AppBaseURL はメールに載せるリンクの起点（Web クライアントの URL）。
	AppBaseURL *url.URL
	Logger     *slog.Logger
}

// Service は認証のユースケース。
type Service struct {
	db           *pgxpool.Pool
	clock        clock.Clock
	ids          id.Generator
	random       io.Reader
	passwords    *PasswordHasher
	accessTokens *AccessTokenIssuer
	revocations  RevocationNotifier
	limiter      RateLimiter
	limits       RateLimits
	storage      Storage
	avatarLimits AvatarLimits
	mailer       Mailer
	appBaseURL   *url.URL
	logger       *slog.Logger
}

// NewService は Service を返す。
func NewService(d Deps) *Service {
	return &Service{
		db:           d.DB,
		clock:        d.Clock,
		ids:          d.IDs,
		random:       d.Random,
		passwords:    d.Passwords,
		accessTokens: d.AccessTokens,
		revocations:  d.Revocations,
		limiter:      d.Limiter,
		limits:       d.Limits,
		storage:      d.Storage,
		avatarLimits: d.AvatarLimits,
		mailer:       d.Mailer,
		appBaseURL:   d.AppBaseURL,
		logger:       d.Logger,
	}
}

// Register はユーザーを作成し、そのままログインしたセッションを返す。確認メールも送る。
func (s *Service) Register(ctx context.Context, in RegisterInput, c Client) (User, Session, error) {
	if err := s.checkRateLimits(ctx, limitKey{s.limits.RegisterPerIP, c.ipKey()}); err != nil {
		return User{}, Session{}, err
	}
	in, err := in.normalize()
	if err != nil {
		return User{}, Session{}, err
	}
	// ハッシュの計算は遅い（数十ミリ秒）ので、トランザクションを開く前に済ませてロックの保持時間を延ばさない。
	hash, err := s.passwords.Hash(in.Password)
	if err != nil {
		return User{}, Session{}, fmt.Errorf("hash password: %w", err)
	}

	now := s.clock.Now()
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return User{}, Session{}, fmt.Errorf("begin: %w", err)
	}
	defer rollback(ctx, tx)
	q := store.New(tx)

	u, err := q.CreateUser(ctx, store.CreateUserParams{
		ID:           s.ids.New(),
		Handle:       in.Handle,
		DisplayName:  in.DisplayName,
		Email:        in.Email,
		PasswordHash: &hash,
		Now:          now,
	})
	if err != nil {
		return User{}, Session{}, createUserError(err)
	}
	sess, err := s.startSession(ctx, q, u.ID, s.ids.New(), nil, c, now)
	if err != nil {
		return User{}, Session{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		// コミット時にも UNIQUE 違反は起こりうる（遅延制約ではないので実際は INSERT 時に出るが、念のため同じ変換を通す）。
		return User{}, Session{}, createUserError(err)
	}

	// 確認メールを送れなくても登録は成功させる。利用者は画面から再送できる。
	if err := s.sendEmailVerification(ctx, u.ID, u.Email); err != nil {
		s.logger.ErrorContext(ctx, "send email verification after register failed",
			slog.String("user_id", u.ID.String()), slog.Any("error", err))
	}
	return toUser(u), sess, nil
}

func createUserError(err error) error {
	switch {
	case isUniqueViolation(err, "users_handle_key"):
		return ErrHandleTaken
	case isUniqueViolation(err, "users_email_key"):
		return ErrEmailTaken
	}
	return fmt.Errorf("create user: %w", err)
}

// isUniqueViolation は err が constraint の UNIQUE 制約の違反かを返す。
func isUniqueViolation(err error, constraint string) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505" && pgErr.ConstraintName == constraint
}

// Login は email とパスワードを検証し、新しいセッションを返す。
//
// 「email が存在しない」「OAuth だけのユーザー」「パスワードが違う」はすべて同じエラーを、
// 同じだけの時間（Argon2id の検証 1 回分）をかけて返す（CLAUDE.md「エラーハンドリング」）。
func (s *Service) Login(ctx context.Context, email, password string, c Client) (User, Session, error) {
	email = strings.TrimSpace(email)
	if err := s.checkRateLimits(ctx,
		limitKey{s.limits.LoginPerIP, c.ipKey()},
		limitKey{s.limits.LoginPerAccount, accountKey(email)},
	); err != nil {
		return User{}, Session{}, err
	}

	q := store.New(s.db)
	u, err := q.GetActiveUserByEmail(ctx, email)
	var hash *string
	switch {
	case err == nil:
		hash = u.PasswordHash
	case errors.Is(err, pgx.ErrNoRows):
		// hash は nil のまま。Compare がダミーのハッシュで検証する。
	default:
		return User{}, Session{}, fmt.Errorf("get user: %w", err)
	}

	ok, err := s.passwords.Compare(password, hash)
	if err != nil {
		return User{}, Session{}, fmt.Errorf("compare password (user %s): %w", u.ID, err)
	}
	if !ok {
		return User{}, Session{}, ErrInvalidCredentials
	}

	sess, err := s.startSession(ctx, q, u.ID, s.ids.New(), nil, c, s.clock.Now())
	if err != nil {
		return User{}, Session{}, err
	}
	return toUser(u), sess, nil
}

// Refresh は Refresh Token をローテーションし、新しいトークンの組を返す。
//
//   - 使われたトークンは rotated として失効させ、同じ family に新しいトークンを発行する
//   - rotated で失効済みのトークンが使われたら、盗まれて先に使われた（または正規の利用者が古いトークンを使った）と
//     みなし、family 全体を reuse_detected で失効させる。どちらが攻撃者か区別できないので、両方を締め出す
//   - 猶予期間は設けない。同じトークンを並行して使うクライアント（複数タブ）も再利用として扱う（ADR 0010）
func (s *Service) Refresh(ctx context.Context, rawToken string, c Client) (Session, error) {
	if rawToken == "" {
		return Session{}, ErrInvalidRefreshToken
	}
	now := s.clock.Now()

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Session{}, fmt.Errorf("begin: %w", err)
	}
	defer rollback(ctx, tx)
	q := store.New(tx)

	rt, err := q.GetRefreshTokenForUpdate(ctx, hashOpaqueToken(rawToken))
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return Session{}, ErrInvalidRefreshToken
	case err != nil:
		return Session{}, fmt.Errorf("get refresh token: %w", err)
	}

	if rt.RevokedAt != nil {
		if rt.RevokedReason != nil && *rt.RevokedReason == revokedRotated {
			return Session{}, s.revokeReusedFamily(ctx, tx, q, rt, now)
		}
		// logout / reuse_detected などで family ごと失効済み。もう一度失効させる必要はない。
		return Session{}, ErrInvalidRefreshToken
	}
	if !now.Before(rt.ExpiresAt) {
		return Session{}, ErrInvalidRefreshToken
	}

	if err := q.MarkRefreshTokenRotated(ctx, store.MarkRefreshTokenRotatedParams{ID: rt.ID, Now: now}); err != nil {
		return Session{}, fmt.Errorf("mark rotated: %w", err)
	}
	sess, err := s.startSession(ctx, q, rt.UserID, rt.FamilyID, &rt.ID, c, now)
	if err != nil {
		return Session{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Session{}, fmt.Errorf("commit: %w", err)
	}
	return sess, nil
}

// revokeReusedFamily は再利用を検知した family を失効させてコミットし、ErrInvalidRefreshToken を返す。
// エラーを返す経路だがロールバックしてはいけない（失効を確定させるため）ので、ここで明示的にコミットする。
func (s *Service) revokeReusedFamily(ctx context.Context, tx pgx.Tx, q *store.Queries, rt store.GetRefreshTokenForUpdateRow, now time.Time) error {
	n, err := q.RevokeRefreshTokenFamily(ctx, store.RevokeRefreshTokenFamilyParams{
		FamilyID: rt.FamilyID,
		Reason:   revokedReuseDetected,
		Now:      now,
	})
	if err != nil {
		return fmt.Errorf("revoke family: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit: %w", err)
	}
	if n > 0 {
		s.logger.WarnContext(ctx, "refresh token reuse detected; session revoked",
			slog.String("user_id", rt.UserID.String()),
			slog.String("session_id", rt.FamilyID.String()))
		s.notifySessionRevoked(ctx, rt.FamilyID)
	}
	return ErrInvalidRefreshToken
}

// Logout は rawToken が属するセッションだけを失効させる。同じユーザーの他のセッションには影響しない（ADR 0007）。
//
// トークンが見つからない・すでに失効済みでもエラーにしない。ログアウトの目的（そのトークンを使えなくする）は
// 達成されているので、クライアントには成功として扱わせる。
func (s *Service) Logout(ctx context.Context, rawToken string) error {
	if rawToken == "" {
		return nil
	}
	q := store.New(s.db)
	familyID, err := q.GetRefreshTokenFamily(ctx, hashOpaqueToken(rawToken))
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return nil
	case err != nil:
		return fmt.Errorf("get refresh token family: %w", err)
	}
	n, err := q.RevokeRefreshTokenFamily(ctx, store.RevokeRefreshTokenFamilyParams{
		FamilyID: familyID,
		Reason:   revokedLogout,
		Now:      s.clock.Now(),
	})
	if err != nil {
		return fmt.Errorf("revoke family: %w", err)
	}
	if n > 0 {
		s.notifySessionRevoked(ctx, familyID)
	}
	return nil
}

// SessionActive は userID のセッション sessionID がまだ有効か（ログアウト・再利用の検知・パスワードリセットで失効しておらず、期限内か）を返す。
// authn.SessionChecker の実装。WebSocket の接続時と接続中の再検証で使う（ADR 0015）。
func (s *Service) SessionActive(ctx context.Context, userID, sessionID ulid.ULID) (bool, error) {
	active, err := store.New(s.db).IsSessionActive(ctx, store.IsSessionActiveParams{FamilyID: sessionID, UserID: userID, Now: s.clock.Now()})
	if err != nil {
		return false, fmt.Errorf("check session: %w", err)
	}
	return active, nil
}

// Me は userID のユーザーを返す。
func (s *Service) Me(ctx context.Context, userID ulid.ULID) (User, error) {
	u, err := store.New(s.db).GetActiveUserByID(ctx, userID)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return User{}, ErrUserNotFound
	case err != nil:
		return User{}, fmt.Errorf("get user: %w", err)
	}
	return s.userWithAvatarURL(ctx, u), nil
}

// startSession は familyID のセッションに新しい Refresh Token を保存し、Access Token と組にして返す。
func (s *Service) startSession(ctx context.Context, q *store.Queries, userID, familyID ulid.ULID, rotatedFrom *ulid.ULID, c Client, now time.Time) (Session, error) {
	raw, hash, err := newOpaqueToken(s.random)
	if err != nil {
		return Session{}, err
	}
	refreshExp := now.Add(RefreshTokenTTL)
	if err := q.CreateRefreshToken(ctx, store.CreateRefreshTokenParams{
		ID:          s.ids.New(),
		UserID:      userID,
		FamilyID:    familyID,
		TokenHash:   hash,
		RotatedFrom: rotatedFrom,
		ExpiresAt:   refreshExp,
		UserAgent:   c.userAgent(),
		Ip:          c.ip(),
		Now:         now,
	}); err != nil {
		return Session{}, fmt.Errorf("create refresh token: %w", err)
	}

	access, accessExp, err := s.accessTokens.Issue(userID, familyID)
	if err != nil {
		return Session{}, err
	}
	return Session{
		ID:                    familyID,
		AccessToken:           access,
		AccessTokenExpiresAt:  accessExp,
		RefreshToken:          raw,
		RefreshTokenExpiresAt: refreshExp,
	}, nil
}

// notifySessionRevoked は失効イベントを publish する。
//
// DB の失効はコミット済みなので、publish に失敗してもリクエストは失敗させない。
// Pub/Sub は元々 at-most-once で、取りこぼしは ws-ticket の消費時の検証などで補う前提（ADR 0007）。
// リクエストの ctx がキャンセルされても publish は試みる。
func (s *Service) notifySessionRevoked(ctx context.Context, sid ulid.ULID) {
	if err := s.revocations.RevokeSession(context.WithoutCancel(ctx), sid); err != nil {
		s.logger.ErrorContext(ctx, "publish session revocation failed",
			slog.String("session_id", sid.String()), slog.Any("error", err))
	}
}

// rollback はコミットしなかったトランザクションを戻す。コミット後に呼んでも何もしない（defer で使う）。
func rollback(ctx context.Context, tx pgx.Tx) {
	_ = tx.Rollback(context.WithoutCancel(ctx))
}
