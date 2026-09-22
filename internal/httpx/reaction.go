package httpx

import (
	"net/http"

	"github.com/shun2218-dev/hibari/internal/chat"
)

// 絵文字のリアクション（ADR 0044）。付ける・外すはどちらも冪等。

// messageReactionResponse は 1 つの絵文字ぶんの集計（ADR 0044 決定 3）。
type messageReactionResponse struct {
	Emoji string `json:"emoji"`
	// Count は付けた人の数。
	Count int64 `json:"count"`
	// Me は閲覧者が付けているか。**REST のレスポンスにだけ入る。**
	// WebSocket の配信は 1 つのペイロードを購読者に配るので、受け取る人ごとの値は載せられない
	// （mentions の「自分宛てか」と同じ理由。ADR 0015 / 0016）。
	// クライアントは、me の無い更新では手元の値をそのまま保つ（me が変わるのは自分の操作のときだけで、
	// そのときは PUT / DELETE の応答が me 付きで返る）。
	Me *bool `json:"me,omitzero"`
	// Users は付けた人の先頭 8 人（最初に付いた順）。ホバーの「A、B 他 N 人」に使う。count より少ないことがある。
	Users []string `json:"users"`
}

func newReactionsResponse(rs []chat.MessageReaction) []messageReactionResponse {
	out := make([]messageReactionResponse, len(rs))
	for i, r := range rs {
		users := make([]string, len(r.Users))
		for j, u := range r.Users {
			users[j] = u.String()
		}
		me := r.Me
		out[i] = messageReactionResponse{Emoji: r.Emoji, Count: r.Count, Me: &me, Users: users}
	}
	return out
}

// changeReaction は PUT / DELETE の共通部分（ADR 0044 決定 4）。
//
// どちらも冪等で、現在のメッセージを 200 で返す。すでに付いている状態の PUT と、
// 付いていない状態の DELETE も 200 になる（URL の形がそのまま「その行があること / ないこと」を表す）。
func (h *chatHandlers) changeReaction(w http.ResponseWriter, r *http.Request, add bool) {
	roomID, err := pathID(r, "roomID")
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	messageID, err := pathID(r, "messageID")
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	// 絵文字はパーセントエンコードして置かれる（%F0%9F%91%8D）。ServeMux が戻したものをそのまま渡し、
	// 絵文字として正しいかは chat が判断する（ADR 0044 決定 5）。正規化はしない。
	emoji := r.PathValue("emoji")
	act := h.svc.AddReaction
	if !add {
		act = h.svc.RemoveReaction
	}
	msg, err := act(r.Context(), actorOf(r), roomID, messageID, emoji)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, newMessageResponse(msg))
}

// addReaction は絵文字のリアクションを付ける。すでに付いていても 200（ADR 0044）。
func (h *chatHandlers) addReaction(w http.ResponseWriter, r *http.Request) {
	h.changeReaction(w, r, true)
}

// removeReaction は絵文字のリアクションを外す。付いていなくても 200（ADR 0044）。
func (h *chatHandlers) removeReaction(w http.ResponseWriter, r *http.Request) {
	h.changeReaction(w, r, false)
}
