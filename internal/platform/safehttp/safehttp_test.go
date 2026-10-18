package safehttp

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"testing"
)

func TestPublicAddr(t *testing.T) {
	tests := []struct {
		addr string
		want bool
	}{
		{"93.184.215.14", true},
		{"2606:2800:21f:cb07:6820:80da:af6b:8b2c", true},
		{"8.8.8.8", true},

		{"127.0.0.1", false},
		{"127.255.255.254", false},
		{"::1", false},
		{"0.0.0.0", false},
		{"::", false},
		{"10.0.0.1", false},
		{"172.16.5.4", false},
		{"192.168.1.1", false},
		{"169.254.169.254", false}, // クラウドのメタデータ
		{"fe80::1", false},
		{"fc00::1", false},
		{"fdaa:0:1::3", false}, // Fly の内部ネットワーク
		{"224.0.0.1", false},
		{"ff02::1", false},
		{"255.255.255.255", false},
		{"100.64.0.1", false}, // CGNAT
		{"198.18.0.1", false},
		{"240.0.0.1", false},
		{"192.0.2.1", false},

		// IPv4 を埋め込んだ IPv6 は、埋め込まれた IPv4 で決まる
		{"::ffff:127.0.0.1", false},
		{"::ffff:10.0.0.1", false},
		{"::ffff:93.184.215.14", true},
		{"64:ff9b::7f00:1", false},     // NAT64 で 127.0.0.1
		{"64:ff9b::a9fe:a9fe", false},  // NAT64 で 169.254.169.254
		{"64:ff9b::5db8:d70e", true},   // NAT64 で 93.184.215.14
		{"::127.0.0.1", false},         // IPv4 互換（廃止）
		{"2002:7f00:1::1", false},      // 6to4 はまとめて拒否
		{"2001:0:4136:e378::1", false}, // Teredo はまとめて拒否
	}
	for _, tt := range tests {
		t.Run(tt.addr, func(t *testing.T) {
			if got := PublicAddr(netip.MustParseAddr(tt.addr)); got != tt.want {
				t.Errorf("PublicAddr(%s) = %v, want %v", tt.addr, got, tt.want)
			}
		})
	}
}

// serverPort は httptest のサーバーのポート。
func serverPort(t *testing.T, s *httptest.Server) uint16 {
	t.Helper()
	u, err := url.Parse(s.URL)
	if err != nil {
		t.Fatal(err)
	}
	p, err := strconv.ParseUint(u.Port(), 10, 16)
	if err != nil {
		t.Fatal(err)
	}
	return uint16(p)
}

// loopbackClient は、ループバックの指定したポートだけに繋げるクライアント（本番の検査の代わり）。
func loopbackClient(ports ...uint16) *Client {
	return New(Options{AllowAddr: func(a netip.Addr) bool { return a.IsLoopback() }, Ports: ports, UserAgent: "hibari-test"})
}

func TestGetBlocksLoopbackByDefault(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte("secret")) }))
	defer s.Close()

	// 既定の検査（PublicAddr）では、ポートを許してもループバックに繋がらない
	c := New(Options{Ports: []uint16{serverPort(t, s)}})
	_, err := c.Get(context.Background(), s.URL, "", 1024)
	if !errors.Is(err, ErrBlocked) {
		t.Fatalf("err = %v, want ErrBlocked", err)
	}
}

func TestGetBlocksNameResolvingToLoopback(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte("secret")) }))
	defer s.Close()

	// 名前（localhost）で書いても、接続する IP で判定する
	c := New(Options{Ports: []uint16{serverPort(t, s)}})
	_, err := c.Get(context.Background(), strings.Replace(s.URL, "127.0.0.1", "localhost", 1), "", 1024)
	if !errors.Is(err, ErrBlocked) {
		t.Fatalf("err = %v, want ErrBlocked", err)
	}
}

func TestGetChecksURLBeforeConnecting(t *testing.T) {
	c := New(Options{})
	for _, raw := range []string{
		"ftp://example.com/",
		"file:///etc/passwd",
		"gopher://example.com/",
		"http://user:pass@example.com/",
		"http://example.com:8080/",
		"http://example.com:22/",
		"http:///path-only",
	} {
		t.Run(raw, func(t *testing.T) {
			if _, err := c.Get(context.Background(), raw, "", 1024); !errors.Is(err, ErrBlocked) {
				t.Errorf("err = %v, want ErrBlocked", err)
			}
		})
	}
}

func TestGetReadsBody(t *testing.T) {
	var gotUA, gotAccept string
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotUA, gotAccept = r.Header.Get("User-Agent"), r.Header.Get("Accept")
		if _, err := r.Cookie("session"); err == nil {
			t.Error("cookie was sent")
		}
		w.Header().Set("Content-Type", "text/html; charset=Shift_JIS")
		_, _ = w.Write([]byte("<html>hello</html>"))
	}))
	defer s.Close()

	res, err := loopbackClient(serverPort(t, s)).Get(context.Background(), s.URL, "text/html", 1024)
	if err != nil {
		t.Fatal(err)
	}
	if string(res.Body) != "<html>hello</html>" || res.Truncated {
		t.Errorf("body = %q truncated=%v", res.Body, res.Truncated)
	}
	if res.ContentType != "text/html" || res.Charset != "Shift_JIS" {
		t.Errorf("content type = %q charset = %q", res.ContentType, res.Charset)
	}
	if gotUA != "hibari-test" || gotAccept != "text/html" {
		t.Errorf("user-agent = %q accept = %q", gotUA, gotAccept)
	}
}

func TestGetTruncatesAtLimit(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(strings.Repeat("a", 100)))
	}))
	defer s.Close()
	c := loopbackClient(serverPort(t, s))

	res, err := c.Get(context.Background(), s.URL, "", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Body) != 10 || !res.Truncated {
		t.Errorf("len = %d truncated = %v", len(res.Body), res.Truncated)
	}

	// ちょうど上限なら切っていない
	res, err = c.Get(context.Background(), s.URL, "", 100)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Body) != 100 || res.Truncated {
		t.Errorf("len = %d truncated = %v", len(res.Body), res.Truncated)
	}
}

func TestGetReturnsStatusError(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNotFound) }))
	defer s.Close()

	_, err := loopbackClient(serverPort(t, s)).Get(context.Background(), s.URL, "", 1024)
	var se *StatusError
	if !errors.As(err, &se) || se.Code != http.StatusNotFound {
		t.Fatalf("err = %v, want StatusError 404", err)
	}
}

func TestGetRedirects(t *testing.T) {
	inner := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte("inner")) }))
	defer inner.Close()
	final := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte("final")) }))
	defer final.Close()
	outer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/to-final":
			http.Redirect(w, r, final.URL+"/page", http.StatusFound)
		case "/to-inner":
			http.Redirect(w, r, inner.URL, http.StatusFound)
		case "/to-file":
			http.Redirect(w, r, "file:///etc/passwd", http.StatusFound)
		default:
			// /loop/N は N 回リダイレクトしてから final へ
			n, _ := strconv.Atoi(strings.TrimPrefix(r.URL.Path, "/loop/"))
			if n == 0 {
				http.Redirect(w, r, final.URL, http.StatusFound)
				return
			}
			http.Redirect(w, r, "/loop/"+strconv.Itoa(n-1), http.StatusFound)
		}
	}))
	defer outer.Close()

	// inner のポートは許さない（内部のサービスに見立てる）
	c := loopbackClient(serverPort(t, outer), serverPort(t, final))

	t.Run("許された先へのリダイレクトは辿る", func(t *testing.T) {
		res, err := c.Get(context.Background(), outer.URL+"/to-final", "", 1024)
		if err != nil {
			t.Fatal(err)
		}
		if string(res.Body) != "final" || res.URL.String() != final.URL+"/page" {
			t.Errorf("body = %q url = %s", res.Body, res.URL)
		}
	})
	t.Run("許されない先へのリダイレクトは接続しない", func(t *testing.T) {
		if _, err := c.Get(context.Background(), outer.URL+"/to-inner", "", 1024); !errors.Is(err, ErrBlocked) {
			t.Errorf("err = %v, want ErrBlocked", err)
		}
	})
	t.Run("http でないスキームへのリダイレクトは辿らない", func(t *testing.T) {
		if _, err := c.Get(context.Background(), outer.URL+"/to-file", "", 1024); !errors.Is(err, ErrBlocked) {
			t.Errorf("err = %v, want ErrBlocked", err)
		}
	})
	t.Run("3 回までは辿る", func(t *testing.T) {
		// /loop/2 → /loop/1 → /loop/0 → final で 3 回
		if _, err := c.Get(context.Background(), outer.URL+"/loop/2", "", 1024); err != nil {
			t.Errorf("err = %v", err)
		}
	})
	t.Run("4 回目は辿らない", func(t *testing.T) {
		if _, err := c.Get(context.Background(), outer.URL+"/loop/3", "", 1024); err == nil {
			t.Error("err = nil, want too many redirects")
		}
	})
}

func TestGetHonorsContext(t *testing.T) {
	block := make(chan struct{})
	s := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		select {
		case <-block:
		case <-r.Context().Done():
		}
	}))
	defer s.Close()
	defer close(block)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := loopbackClient(serverPort(t, s)).Get(ctx, s.URL, "", 1024); !errors.Is(err, context.Canceled) {
		t.Errorf("err = %v, want context.Canceled", err)
	}
}
