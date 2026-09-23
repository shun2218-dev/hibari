package chat_test

import (
	"errors"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat"
	"github.com/shun2218-dev/hibari/internal/chat/chattest"
)

// メッセージの検索（ADR 0061）。
//
// 索引が効くこと自体は db/search_index_test.go が見る。ここで見るのは、
// 「誰が何を見つけられるか」（決定 3）と、語の解釈・絞り込み・ページング（決定 4〜6）。

func search(t *testing.T, env *chattest.Env, actor, workspaceID ulid.ULID, q chat.SearchQuery) chat.SearchPage {
	t.Helper()
	page, err := env.Service.SearchMessages(t.Context(), actor, workspaceID, q)
	if err != nil {
		t.Fatalf("SearchMessages(%+v): %v", q, err)
	}
	return page
}

// assertFieldError は、その項目の検証エラーで断られたことを確かめる。
func assertFieldError(t *testing.T, err error, field string) {
	t.Helper()
	var ve *chat.ValidationError
	if !errors.As(err, &ve) {
		t.Fatalf("err = %v, want ValidationError(%s)", err, field)
	}
	if !slices.ContainsFunc(ve.Fields, func(f chat.FieldError) bool { return f.Field == field }) {
		t.Errorf("err = %v, want a field error on %q", err, field)
	}
}

// searchBodies は結果の本文を並びのまま返す（新しい順）。
func searchBodies(page chat.SearchPage) []string {
	out := make([]string, len(page.Results))
	for i, r := range page.Results {
		out[i] = r.Body
	}
	return out
}

func searchIDs(page chat.SearchPage) []ulid.ULID {
	out := make([]ulid.ULID, len(page.Results))
	for i, r := range page.Results {
		out[i] = r.ID
	}
	return out
}

// TestSearchMessagesAuthz は「読めるルームのメッセージだけが出る」ことを、authz の組み合わせで確かめる。
// `readable_rooms` の CTE は authz.CanReadRoom の写しなので、片方だけ変えると読めないものが漏れる。
func TestSearchMessagesAuthz(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)

	// member が作る: 参加している public / 参加している private / member2 との DM
	pub := createRoom(t, env, r.member, r.ws.ID, "public", "kensaku-public")
	priv := createRoom(t, env, r.member, r.ws.ID, "private", "kensaku-private")
	if err := env.Service.AddRoomMember(t.Context(), r.member, priv.ID, r.member2); err != nil {
		t.Fatal(err)
	}
	dm, _ := createDM(t, env, r.member, r.ws.ID, r.member2)
	send(t, env, r.member, pub.ID, "公開の面談の話")
	send(t, env, r.member, priv.ID, "非公開の面談の話")
	send(t, env, r.member, dm.ID, "DM の面談の話")

	q := chat.SearchQuery{Text: "面談"}

	t.Run("参加している人は 3 つとも見つける", func(t *testing.T) {
		got := searchBodies(search(t, env, r.member2, r.ws.ID, q))
		slices.Sort(got)
		want := []string{"DM の面談の話", "公開の面談の話", "非公開の面談の話"}
		slices.Sort(want)
		if !slices.Equal(got, want) {
			t.Errorf("member2 = %q, want %q", got, want)
		}
	})

	t.Run("参加していないワークスペースのメンバーは public だけ", func(t *testing.T) {
		// admin は 3 つのどのルームにも入っていない。public は参加していなくても読める（ADR 0011）
		got := searchBodies(search(t, env, r.admin, r.ws.ID, q))
		if !slices.Equal(got, []string{"公開の面談の話"}) {
			t.Errorf("admin = %q, want [公開の面談の話]", got)
		}
	})

	t.Run("ワークスペースの外の人は 404（結果を空で返さない）", func(t *testing.T) {
		_, err := env.Service.SearchMessages(t.Context(), r.outsider, r.ws.ID, q)
		if !errors.Is(err, chat.ErrNotFound) {
			t.Errorf("outsider = %v, want ErrNotFound", err)
		}
	})

	t.Run("private から抜けると、その本文は見つからなくなる（いまの権限で判定する）", func(t *testing.T) {
		if err := env.Service.RemoveRoomMember(t.Context(), r.member2, priv.ID, r.member2); err != nil {
			t.Fatal(err)
		}
		got := searchBodies(search(t, env, r.member2, r.ws.ID, q))
		if slices.Contains(got, "非公開の面談の話") {
			t.Errorf("member2 = %q, まだ非公開の本文が出ている", got)
		}
	})
}

// TestSearchMessagesMatching は何が一致するか（決定 2 / 6）。DoD の「日本語と英語で検索できる」もここで見る。
func TestSearchMessagesMatching(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	room := createRoom(t, env, r.member, r.ws.ID, "public", "kensaku")

	send(t, env, r.member, room.ID, "明日の面談の資料を共有します")
	send(t, env, r.member, room.ID, "Deploy が終わりました")
	send(t, env, r.member, room.ID, "リリースの確認をお願いします")
	pct := send(t, env, r.member, room.ID, "進捗は 80% です")

	tests := []struct {
		name string
		text string
		want []string
	}{
		{"2 文字の日本語", "面談", []string{"明日の面談の資料を共有します"}},
		{"1 文字でも探せる", "談", []string{"明日の面談の資料を共有します"}},
		{"英語", "deploy", []string{"Deploy が終わりました"}},
		{"大文字小文字を無視する", "DEPLOY", []string{"Deploy が終わりました"}},
		{"全角で打っても半角に当たる", "ｄｅｐｌｏｙ", []string{"Deploy が終わりました"}},
		{"複数の語は AND", "面談 資料", []string{"明日の面談の資料を共有します"}},
		{"AND なので片方だけでは出ない", "面談 リリース", nil},
		{"フレーズは並びのまま探す", `"面談の資料"`, []string{"明日の面談の資料を共有します"}},
		{"フレーズの並びが違えば出ない", `"資料の面談"`, nil},
		{"除外", "の 面談", []string{"明日の面談の資料を共有します"}},
		{"除外で消せる", "の -面談", []string{"リリースの確認をお願いします"}},
		{"一致しない語", "ハチドリ", nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := searchBodies(search(t, env, r.member, r.ws.ID, chat.SearchQuery{Text: tt.text}))
			slices.Sort(got)
			want := slices.Clone(tt.want)
			slices.Sort(want)
			if !slices.Equal(got, want) {
				t.Errorf("search(%q) = %q, want %q", tt.text, got, want)
			}
		})
	}

	// LIKE のワイルドカードは打ち消す。エスケープを忘れると、`%` の検索が全件に当たる
	t.Run("% は文字として扱う", func(t *testing.T) {
		got := searchIDs(search(t, env, r.member, r.ws.ID, chat.SearchQuery{Text: "80%"}))
		if !slices.Equal(got, []ulid.ULID{pct.ID}) {
			t.Errorf("search(80%%) = %v, want [%v]", got, pct.ID)
		}
	})

	// 全角の ％ は NFKC で % になる。**正規化してからエスケープ**しないとワイルドカードになる
	t.Run("全角の ％ もワイルドカードにしない", func(t *testing.T) {
		got := searchIDs(search(t, env, r.member, r.ws.ID, chat.SearchQuery{Text: "80％"}))
		if !slices.Equal(got, []ulid.ULID{pct.ID}) {
			t.Errorf("search(80％) = %v, want [%v]", got, pct.ID)
		}
	})

	t.Run("_ も文字として扱う", func(t *testing.T) {
		send(t, env, r.member, room.ID, "a_b の話")
		got := searchBodies(search(t, env, r.member, r.ws.ID, chat.SearchQuery{Text: "a_b"}))
		if !slices.Equal(got, []string{"a_b の話"}) {
			t.Errorf("search(a_b) = %q", got)
		}
	})

	t.Run("塗る語を返す（クライアントはこれを本文に重ねる）", func(t *testing.T) {
		page := search(t, env, r.member, r.ws.ID, chat.SearchQuery{Text: `面談 "の資料" -リリース`})
		if !slices.Equal(page.Terms, []string{"面談", "の資料"}) {
			t.Errorf("terms = %q, want [面談 の資料]（除外した語は塗らない）", page.Terms)
		}
	})
}

// TestSearchMessagesDeletedAndEdited は DoD の「削除したメッセージは結果に出ず、編集後の本文で見つかる」。
func TestSearchMessagesDeletedAndEdited(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	room := createRoom(t, env, r.member, r.ws.ID, "public", "kensaku")

	deleted := send(t, env, r.member, room.ID, "消す予定の面談の話")
	edited := send(t, env, r.member, room.ID, "最初の本文")
	system := roomSystemMessages(t, env, r.member, room.ID)

	if err := env.Service.DeleteMessage(t.Context(), r.member, room.ID, deleted.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := env.Service.EditMessage(t.Context(), r.member, room.ID, edited.ID, "直したあとの面談の話"); err != nil {
		t.Fatal(err)
	}

	got := searchBodies(search(t, env, r.member, r.ws.ID, chat.SearchQuery{Text: "面談"}))
	if !slices.Equal(got, []string{"直したあとの面談の話"}) {
		t.Errorf("search = %q, want [直したあとの面談の話]（削除済みは出さず、編集後の本文で見つかる）", got)
	}

	t.Run("編集前の本文では見つからない", func(t *testing.T) {
		if got := searchBodies(search(t, env, r.member, r.ws.ID, chat.SearchQuery{Text: "最初の本文"})); len(got) != 0 {
			t.Errorf("search(最初の本文) = %q, want []", got)
		}
	})

	t.Run("参加のログ（システムメッセージ）は出さない", func(t *testing.T) {
		if len(system) == 0 {
			t.Skip("このルームにはシステムメッセージがない")
		}
		page := search(t, env, r.member, r.ws.ID, chat.SearchQuery{Text: "参加"})
		for _, res := range page.Results {
			if slices.Contains(system, res.ID) {
				t.Errorf("システムメッセージ %v が結果に出ている", res.ID)
			}
		}
	})
}

// roomSystemMessages はルームのシステムメッセージの ID を返す。
func roomSystemMessages(t *testing.T, env *chattest.Env, actor, roomID ulid.ULID) []ulid.ULID {
	t.Helper()
	page, err := env.Service.ListMessages(t.Context(), actor, roomID, chat.MessageQuery{})
	if err != nil {
		t.Fatal(err)
	}
	var ids []ulid.ULID
	for _, m := range page.Messages {
		if m.Kind == chat.MessageKindSystem {
			ids = append(ids, m.ID)
		}
	}
	return ids
}

// TestSearchMessagesArchivedRoom はアーカイブしたチャンネルの履歴が検索できること（ADR 0059 / 0061 決定 3）。
func TestSearchMessagesArchivedRoom(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	room := createRoom(t, env, r.member, r.ws.ID, "public", "kensaku-archived")
	send(t, env, r.member, room.ID, "アーカイブ前の面談の話")

	if _, err := env.Service.ArchiveRoom(t.Context(), r.member, room.ID); err != nil {
		t.Fatal(err)
	}

	got := searchBodies(search(t, env, r.member, r.ws.ID, chat.SearchQuery{Text: "面談"}))
	if !slices.Equal(got, []string{"アーカイブ前の面談の話"}) {
		t.Errorf("search = %q, want [アーカイブ前の面談の話]（アーカイブは「書けない」であって「読めない」ではない）", got)
	}
}

// TestSearchMessagesFilters は絞り込み（決定 5）。
func TestSearchMessagesFilters(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	a := createRoom(t, env, r.member, r.ws.ID, "public", "kensaku-a")
	b := createRoom(t, env, r.member, r.ws.ID, "public", "kensaku-b")
	if _, err := env.Service.JoinRoom(t.Context(), r.member2, a.ID); err != nil {
		t.Fatal(err)
	}

	inA := send(t, env, r.member, a.ID, "A の面談")
	inB := send(t, env, r.member, b.ID, "B の面談")
	byMember2 := send(t, env, r.member2, a.ID, "member2 の面談")

	tests := []struct {
		name string
		q    chat.SearchQuery
		want []ulid.ULID
	}{
		{"ルームで絞る", chat.SearchQuery{Text: "面談", RoomIDs: []ulid.ULID{a.ID}}, []ulid.ULID{byMember2.ID, inA.ID}},
		{"ルームを除く", chat.SearchQuery{Text: "面談", ExcludeRoomIDs: []ulid.ULID{a.ID}}, []ulid.ULID{inB.ID}},
		{"送信者で絞る", chat.SearchQuery{Text: "面談", SenderIDs: []ulid.ULID{r.member2}}, []ulid.ULID{byMember2.ID}},
		{"送信者を除く", chat.SearchQuery{Text: "面談", ExcludeSenderIDs: []ulid.ULID{r.member2}}, []ulid.ULID{inB.ID, inA.ID}},
		{
			"ルームと送信者を重ねる",
			chat.SearchQuery{Text: "面談", RoomIDs: []ulid.ULID{a.ID}, SenderIDs: []ulid.ULID{r.member}},
			[]ulid.ULID{inA.ID},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := searchIDs(search(t, env, r.member, r.ws.ID, tt.q)); !slices.Equal(got, tt.want) {
				t.Errorf("search = %v, want %v", got, tt.want)
			}
		})
	}

	t.Run("日付で絞る", func(t *testing.T) {
		// Clock は固定なので、送った時刻の前後で区切る
		at := inA.CreatedAt
		before := at.Add(-time.Nanosecond)
		if got := searchIDs(search(t, env, r.member, r.ws.ID, chat.SearchQuery{Text: "面談", Before: &before})); len(got) != 0 {
			t.Errorf("before = %v, want []", got)
		}
		after := at
		got := searchIDs(search(t, env, r.member, r.ws.ID, chat.SearchQuery{Text: "面談", After: &after}))
		if len(got) != 3 {
			t.Errorf("after = %v, want 3 件", got)
		}
	})
}

// TestSearchMessagesPaging はカーソル方式のページング（決定 4）。
func TestSearchMessagesPaging(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	room := createRoom(t, env, r.member, r.ws.ID, "public", "kensaku-page")

	var want []ulid.ULID
	for range 5 {
		want = append(want, send(t, env, r.member, room.ID, "面談の話").ID)
	}
	// 新しい順に並べ直す
	slices.Reverse(want)

	var got []ulid.ULID
	q := chat.SearchQuery{Text: "面談", Limit: 2}
	for range 5 {
		page := search(t, env, r.member, r.ws.ID, q)
		got = append(got, searchIDs(page)...)
		if page.NextCursor == "" {
			break
		}
		q.Cursor = page.NextCursor
	}
	if !slices.Equal(got, want) {
		t.Errorf("paged = %v, want %v（新しい順に欠番も重複もなく回る）", got, want)
	}

	t.Run("壊れたカーソルは 422", func(t *testing.T) {
		_, err := env.Service.SearchMessages(t.Context(), r.member, r.ws.ID, chat.SearchQuery{Text: "面談", Cursor: "!!"})
		assertFieldError(t, err, "cursor")
	})
}

// TestSearchMessagesValidation は入力の検証（決定 6）。
func TestSearchMessagesValidation(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)

	tests := []struct {
		name  string
		q     chat.SearchQuery
		field string
	}{
		{"空っぽ", chat.SearchQuery{Text: ""}, "q"},
		{"空白だけ", chat.SearchQuery{Text: "   "}, "q"},
		{"除外だけ（索引を引けない）", chat.SearchQuery{Text: "-面談"}, "q"},
		{"語が多すぎる", chat.SearchQuery{Text: "a b c d e f g h i"}, "q"},
		{"長すぎる", chat.SearchQuery{Text: strings.Repeat("あ", chat.MaxSearchQueryLen+1)}, "q"},
		{"limit が上限より大きい", chat.SearchQuery{Text: "面談", Limit: 51}, "limit"},
		{"limit が負", chat.SearchQuery{Text: "面談", Limit: -1}, "limit"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := env.Service.SearchMessages(t.Context(), r.member, r.ws.ID, tt.q)
			assertFieldError(t, err, tt.field)
		})
	}

	t.Run("after が before 以降なら 422", func(t *testing.T) {
		at := time.Date(2026, 9, 23, 0, 0, 0, 0, time.UTC)
		_, err := env.Service.SearchMessages(t.Context(), r.member, r.ws.ID,
			chat.SearchQuery{Text: "面談", After: &at, Before: &at})
		assertFieldError(t, err, "after")
	})
}
