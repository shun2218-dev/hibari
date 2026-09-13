package httpx

import (
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
)

// maxJSONBodyBytes は JSON のリクエストボディの上限。認証の API はどれも数百バイトに収まる。
const maxJSONBodyBytes = 64 << 10

// decodeJSON はリクエストボディを dst に読み込む。
//
// Content-Type が application/json でなければ拒否する。text/plain やフォームの POST は
// CORS のプリフライトなしに他のオリジンから送れるので、それを受け付けると CSRF（ログイン CSRF など）の入口になる。
func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) error {
	mt, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mt != "application/json" {
		return &errBadRequest{status: http.StatusUnsupportedMediaType, detail: "Content-Type must be application/json"}
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxJSONBodyBytes))
	if err := dec.Decode(dst); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			return &errBadRequest{status: http.StatusRequestEntityTooLarge, detail: "request body is too large"}
		}
		return &errBadRequest{status: http.StatusBadRequest, detail: "request body is not valid JSON"}
	}
	// 1 つ目の値の後ろにゴミが続くボディは、途中で切り詰められたか、別の形式のものとみなして拒否する。
	if _, err := dec.Token(); !errors.Is(err, io.EOF) {
		return &errBadRequest{status: http.StatusBadRequest, detail: "request body must contain a single JSON value"}
	}
	return nil
}

// writeJSON は v を JSON で書く。API のレスポンスはユーザーごとに異なり、トークンを含むこともあるので、
// 呼び出し側が明示しない限り共有キャッシュにもブラウザにも保存させない。
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	if w.Header().Get("Cache-Control") == "" {
		w.Header().Set("Cache-Control", "no-store")
	}
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
