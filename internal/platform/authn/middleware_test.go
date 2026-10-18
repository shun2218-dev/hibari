package authn_test

import (
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/lestrrat-go/jwx/v3/jwt"

	"github.com/shun2218-dev/hibari/internal/platform/authn"
	"github.com/shun2218-dev/hibari/internal/platform/clock"
)

func TestRequire(t *testing.T) {
	pub, priv, _ := ed25519.GenerateKey(rand.Reader)
	v := authn.NewVerifier([]authn.PublicKey{{ID: kid, Key: pub}}, issuer, audience, clock.NewFake(now))
	spec := validSpec(t, priv)
	valid := sign(t, spec)

	tests := []struct {
		name    string
		header  string
		url     string
		wantErr error // nil なら next が呼ばれる
	}{
		{name: "bearer", header: "Bearer " + valid},
		{name: "scheme is case-insensitive", header: "bearer " + valid},
		{name: "no header", wantErr: authn.ErrMissingToken},
		// クエリ文字列のトークンは読まない（URL はログに残るため）。
		{name: "token in query", url: "/?access_token=" + valid, wantErr: authn.ErrMissingToken},
		{name: "basic scheme", header: "Basic dXNlcjpwYXNz", wantErr: authn.ErrInvalidToken},
		{name: "bearer without token", header: "Bearer ", wantErr: authn.ErrInvalidToken},
		{name: "invalid token", header: "Bearer " + valid + "x", wantErr: authn.ErrInvalidToken},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var (
				gotErr    error
				nextID    authn.Identity
				nextSeen  bool
				unauthHit bool
			)
			h := authn.Require(v, func(w http.ResponseWriter, _ *http.Request, err error) {
				unauthHit = true
				gotErr = err
				w.WriteHeader(http.StatusUnauthorized)
			})(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
				nextSeen = true
				nextID, _ = authn.FromContext(r.Context())
			}))

			url := tt.url
			if url == "" {
				url = "/"
			}
			req := httptest.NewRequest(http.MethodGet, url, nil)
			if tt.header != "" {
				req.Header.Set("Authorization", tt.header)
			}
			h.ServeHTTP(httptest.NewRecorder(), req)

			if tt.wantErr != nil {
				if nextSeen || !unauthHit || !errors.Is(gotErr, tt.wantErr) {
					t.Fatalf("next called = %v, unauthorized err = %v; want unauthorized with %v", nextSeen, gotErr, tt.wantErr)
				}
				return
			}
			if !nextSeen || unauthHit {
				t.Fatalf("next called = %v, unauthorized called = %v (err %v)", nextSeen, unauthHit, gotErr)
			}
			if nextID.UserID.String() != spec.claims[jwt.SubjectKey] {
				t.Fatalf("identity in context = %+v", nextID)
			}
		})
	}
}

func TestFromContextWithoutIdentity(t *testing.T) {
	if _, ok := authn.FromContext(t.Context()); ok {
		t.Fatal("FromContext() ok = true for a context without identity")
	}
}

func TestRequireVerifiedEmail(t *testing.T) {
	tests := []struct {
		name     string
		enforce  bool
		verified bool
		wantNext bool
	}{
		{name: "verified", enforce: true, verified: true, wantNext: true},
		{name: "unverified is stopped", enforce: true, verified: false, wantNext: false},
		// 開発環境で外したとき（ADR 0053 決定 4）。
		{name: "not enforced", enforce: false, verified: false, wantNext: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var (
				nextSeen bool
				gotErr   error
			)
			h := authn.RequireVerifiedEmail(tt.enforce, func(w http.ResponseWriter, _ *http.Request, err error) {
				gotErr = err
				w.WriteHeader(http.StatusForbidden)
			})(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { nextSeen = true }))

			req := httptest.NewRequest(http.MethodGet, "/", nil)
			req = req.WithContext(authn.WithIdentity(req.Context(), authn.Identity{EmailVerified: tt.verified}))
			h.ServeHTTP(httptest.NewRecorder(), req)

			if nextSeen != tt.wantNext {
				t.Fatalf("next called = %v, want %v", nextSeen, tt.wantNext)
			}
			if !tt.wantNext && !errors.Is(gotErr, authn.ErrEmailUnverified) {
				t.Fatalf("forbidden err = %v, want ErrEmailUnverified", gotErr)
			}
		})
	}
}

// TestRequireVerifiedEmailOutsideRequire は、Require の外に置く誤りを通さないことを確かめる。
func TestRequireVerifiedEmailOutsideRequire(t *testing.T) {
	h := authn.RequireVerifiedEmail(true, func(http.ResponseWriter, *http.Request, error) {})(
		http.HandlerFunc(func(http.ResponseWriter, *http.Request) { t.Fatal("next must not be called") }))
	defer func() {
		if recover() == nil {
			t.Fatal("RequireVerifiedEmail without identity did not panic")
		}
	}()
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/", nil))
}
