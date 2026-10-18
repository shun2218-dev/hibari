package httpx

import (
	"encoding/json/jsontext"
	"encoding/json/v2"
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
	dec := jsontext.NewDecoder(http.MaxBytesReader(w, r.Body, maxJSONBodyBytes))
	// v2 は、フィールド名を大文字小文字まで一致させ、重複したキーと不正な UTF-8 を拒否する（ADR 0023）。
	if err := json.UnmarshalDecode(dec, dst); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			return &errBadRequest{status: http.StatusRequestEntityTooLarge, detail: "request body is too large"}
		}
		return &errBadRequest{status: http.StatusBadRequest, detail: "request body is not valid JSON"}
	}
	// 1 つ目の値の後ろにゴミが続くボディは、途中で切り詰められたか、別の形式のものとみなして拒否する。
	if _, err := dec.ReadToken(); !errors.Is(err, io.EOF) {
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
	b, err := marshalJSON(v)
	if err != nil {
		// 書き出せない型はプログラムのバグ。ヘッダはもう送ったので、本文を空にするしかない。
		return
	}
	_, _ = w.Write(b)
}

// marshalJSON は、サーバーが書き出す JSON（REST のレスポンス、Problem、WebSocket のフレーム）をすべて作る。
// 経路を 1 つにして、生成した TypeScript の型との一致を 1 箇所で検査する（tsgen_test.go）。
//
// v2 は nil のスライスを []、nil の map を {} にするので、ハンドラが make し忘れても null にならない（ADR 0023）。
//
// v2 は map のキーを既定では並べ替えないので、v1 と同じく並べ替えて、同じ値からは同じバイト列を作る。
func marshalJSON(v any) ([]byte, error) {
	return json.Marshal(v, json.Deterministic(true))
}
