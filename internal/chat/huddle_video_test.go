package chat_test

import (
	"errors"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat"
	"github.com/shun2218-dev/hibari/internal/chat/chattest"
)

// ハドルのカメラと画面共有（ADR 0068）のサービスのテスト。Cloudflare は chattest.Media（偽物）、いま入っている人は実物の Redis。

// lastHuddle は、配った huddle.updated のうち最後のものの、userID の参加者を返す。
func lastHuddle(t *testing.T, evs []chat.Event, userID ulid.ULID) chat.RoomHuddleParticipant {
	t.Helper()
	updated := eventsOfType(evs, chat.EventHuddleUpdated)
	if len(updated) == 0 {
		t.Fatal("no huddle.updated")
	}
	h := updated[len(updated)-1].Data.(chat.HuddleUpdated).Huddle
	if h == nil {
		t.Fatal("huddle ended")
	}
	for _, p := range h.Participants {
		if p.UserID == userID {
			return p
		}
	}
	t.Fatalf("%s is not in the huddle", userID)
	return chat.RoomHuddleParticipant{}
}

// sessionOf は、偽の Cloudflare に送り始めたトラックのうち trackName/mid のもののセッションを返す。
func sessionOf(t *testing.T, env *chattest.Env, trackName, mid string) string {
	t.Helper()
	for _, p := range env.Media.Pushed() {
		if strings.HasSuffix(p, "/"+trackName+"/"+mid) {
			return strings.TrimSuffix(p, "/"+trackName+"/"+mid)
		}
	}
	t.Fatalf("%s/%s was not pushed: %v", trackName, mid, env.Media.Pushed())
	return ""
}

func TestPublishHuddleTrack(t *testing.T) {
	env := chattest.New(t)
	r, room := huddleRoom(t, env)
	a := joinHuddle(t, env, r.member, room.ID)
	joinHuddle(t, env, r.member2, room.ID)
	env.Deliveries.Take()

	t.Run("カメラを送り始めると、音声と同じセッションに足して answer を返し、camera を配る", func(t *testing.T) {
		answer, err := env.Service.PublishHuddleTrack(t.Context(), r.member, a.Huddle.ID, a.ParticipantID, chat.HuddleTrackCamera, chattest.Offer, "1")
		if err != nil {
			t.Fatal(err)
		}
		if answer.Type != "answer" {
			t.Errorf("answer = %+v", answer)
		}
		sessionOf(t, env, "camera", "1")
		if p := lastHuddle(t, env.Deliveries.Take(), r.member); !p.Camera || p.Screen {
			t.Errorf("participant = %+v", p)
		}
	})

	t.Run("もう一度送り始めたら、前のトラックを閉じる", func(t *testing.T) {
		if _, err := env.Service.PublishHuddleTrack(t.Context(), r.member, a.Huddle.ID, a.ParticipantID, chat.HuddleTrackCamera, chattest.Offer, "2"); err != nil {
			t.Fatal(err)
		}
		session := sessionOf(t, env, "camera", "1")
		if !slices.Contains(env.Media.ClosedMids(), session+"/1") {
			t.Errorf("closed mids = %v", env.Media.ClosedMids())
		}
		env.Deliveries.Take()
	})

	t.Run("やめるとトラックを閉じて、camera を外して配る（止めたまま送り続けない。決定 2）", func(t *testing.T) {
		if err := env.Service.UnpublishHuddleTrack(t.Context(), r.member, a.Huddle.ID, a.ParticipantID, chat.HuddleTrackCamera); err != nil {
			t.Fatal(err)
		}
		if !slices.Contains(env.Media.ClosedMids(), sessionOf(t, env, "camera", "2")+"/2") {
			t.Errorf("closed mids = %v", env.Media.ClosedMids())
		}
		if p := lastHuddle(t, env.Deliveries.Take(), r.member); p.Camera {
			t.Errorf("participant = %+v", p)
		}
	})

	t.Run("もうやめていても成功にし、配り直さない", func(t *testing.T) {
		if err := env.Service.UnpublishHuddleTrack(t.Context(), r.member, a.Huddle.ID, a.ParticipantID, chat.HuddleTrackCamera); err != nil {
			t.Fatal(err)
		}
		if n := len(eventsOfType(env.Deliveries.Take(), chat.EventHuddleUpdated)); n != 0 {
			t.Errorf("huddle.updated = %d", n)
		}
	})

	t.Run("音声は入る・抜けるで送るので、ここでは扱わない", func(t *testing.T) {
		_, err := env.Service.PublishHuddleTrack(t.Context(), r.member, a.Huddle.ID, a.ParticipantID, chat.HuddleTrackAudio, chattest.Offer, "3")
		var ve *chat.ValidationError
		if !errors.As(err, &ve) {
			t.Errorf("publish audio = %v", err)
		}
	})

	t.Run("他人の参加 ID では送れない", func(t *testing.T) {
		_, err := env.Service.PublishHuddleTrack(t.Context(), r.member2, a.Huddle.ID, a.ParticipantID, chat.HuddleTrackCamera, chattest.Offer, "1")
		if !errors.Is(err, chat.ErrHuddleParticipantGone) {
			t.Errorf("publish with someone else's participant = %v", err)
		}
	})

	t.Run("Cloudflare に失敗したら、状態に書かない", func(t *testing.T) {
		env.Media.FailPush = true
		defer func() { env.Media.FailPush = false }()
		if _, err := env.Service.PublishHuddleTrack(t.Context(), r.member, a.Huddle.ID, a.ParticipantID, chat.HuddleTrackScreen, chattest.Offer, "4"); err == nil {
			t.Fatal("publish succeeded")
		}
		if n := len(eventsOfType(env.Deliveries.Take(), chat.EventHuddleUpdated)); n != 0 {
			t.Errorf("huddle.updated = %d", n)
		}
	})
}

// 画面を同時に共有できるのは 2 人まで（ADR 0068 決定 7）。3 人目は Cloudflare を呼ぶ前に断る。
// 同時に押しても 2 人を超えず、上限に当たった人の送り始めたトラックは閉じる（並行テスト）。
func TestHuddleScreenShareLimit(t *testing.T) {
	env := chattest.New(t)
	r, room := huddleRoom(t, env)
	for _, u := range []ulid.ULID{r.owner, r.admin2} {
		if _, err := env.Service.JoinRoom(t.Context(), u, room.ID); err != nil {
			t.Fatal(err)
		}
	}
	users := []ulid.ULID{r.member, r.member2, r.admin, r.owner, r.admin2}
	joined := make([]chat.JoinedHuddle, len(users))
	for i, u := range users {
		joined[i] = joinHuddle(t, env, u, room.ID)
	}

	var wg sync.WaitGroup
	var mu sync.Mutex
	var sharing, refused []int
	for i, u := range users {
		wg.Go(func() {
			_, err := env.Service.PublishHuddleTrack(t.Context(), u, joined[i].Huddle.ID, joined[i].ParticipantID, chat.HuddleTrackScreen, chattest.Offer, "2")
			mu.Lock()
			defer mu.Unlock()
			switch {
			case err == nil:
				sharing = append(sharing, i)
			case errors.Is(err, chat.ErrHuddleScreenShareFull):
				refused = append(refused, i)
			default:
				t.Error(err)
			}
		})
	}
	wg.Wait()
	if len(sharing) != chat.HuddleScreenShareLimit || len(refused) != len(users)-chat.HuddleScreenShareLimit {
		t.Fatalf("sharing %v, refused %v", sharing, refused)
	}
	// Cloudflare に送り始めてから上限に当たった人の分は閉じている（送り続けるトラックは共有している 2 人の分だけ）
	if open := len(env.Media.Pushed()) - len(env.Media.ClosedMids()); open != chat.HuddleScreenShareLimit {
		t.Errorf("pushed %v, closed %v", env.Media.Pushed(), env.Media.ClosedMids())
	}

	t.Run("上限のときは Cloudflare を呼ばずに断る", func(t *testing.T) {
		i := refused[0]
		pushed := len(env.Media.Pushed())
		_, err := env.Service.PublishHuddleTrack(t.Context(), users[i], joined[i].Huddle.ID, joined[i].ParticipantID, chat.HuddleTrackScreen, chattest.Offer, "2")
		if !errors.Is(err, chat.ErrHuddleScreenShareFull) || len(env.Media.Pushed()) != pushed {
			t.Errorf("err = %v, pushed %d → %d", err, pushed, len(env.Media.Pushed()))
		}
	})

	t.Run("1 人がやめれば、次の人が共有できる", func(t *testing.T) {
		s := sharing[0]
		if err := env.Service.UnpublishHuddleTrack(t.Context(), users[s], joined[s].Huddle.ID, joined[s].ParticipantID, chat.HuddleTrackScreen); err != nil {
			t.Fatal(err)
		}
		i := refused[0]
		if _, err := env.Service.PublishHuddleTrack(t.Context(), users[i], joined[i].Huddle.ID, joined[i].ParticipantID, chat.HuddleTrackScreen, chattest.Offer, "2"); err != nil {
			t.Errorf("after one stopped: %v", err)
		}
	})
}

func TestSubscribeHuddleVideo(t *testing.T) {
	env := chattest.New(t)
	r, room := huddleRoom(t, env)
	a := joinHuddle(t, env, r.member, room.ID)
	b := joinHuddle(t, env, r.member2, room.ID)
	joinHuddle(t, env, r.admin, room.ID)
	for kind, mid := range map[chat.HuddleTrackKind]string{chat.HuddleTrackCamera: "1", chat.HuddleTrackScreen: "2"} {
		if _, err := env.Service.PublishHuddleTrack(t.Context(), r.member2, b.Huddle.ID, b.ParticipantID, kind, chattest.Offer, mid); err != nil {
			t.Fatal(err)
		}
	}

	t.Run("音声・カメラ・画面を種類ごとに受け、カメラには層を付ける", func(t *testing.T) {
		got, err := env.Service.SubscribeHuddle(t.Context(), r.member, a.Huddle.ID, a.ParticipantID, []chat.HuddleTrackRequest{
			{UserID: r.member2, Kind: chat.HuddleTrackAudio},
			{UserID: r.member2, Kind: chat.HuddleTrackCamera, Quality: chat.HuddleQualityMedium},
			{UserID: r.member2, Kind: chat.HuddleTrackScreen},
			// カメラを付けていない人のカメラは黙って飛ばす
			{UserID: r.admin, Kind: chat.HuddleTrackCamera, Quality: chat.HuddleQualityLow},
		})
		if err != nil {
			t.Fatal(err)
		}
		var kinds []chat.HuddleTrackKind
		for _, tr := range got.Tracks {
			if tr.UserID != r.member2 || tr.Mid == "" {
				t.Errorf("track = %+v", tr)
			}
			kinds = append(kinds, tr.Kind)
		}
		if !slices.Equal(kinds, []chat.HuddleTrackKind{chat.HuddleTrackAudio, chat.HuddleTrackCamera, chat.HuddleTrackScreen}) {
			t.Errorf("kinds = %v", kinds)
		}
		var camera chat.RemoteTrack
		for _, rt := range env.Media.Subscribed() {
			if rt.TrackName == "camera" {
				camera = rt
			}
		}
		if camera.Quality != chat.HuddleQualityMedium {
			t.Errorf("camera remote = %+v", camera)
		}
	})

	t.Run("カメラは層が要り、音声と画面には付けない", func(t *testing.T) {
		for _, req := range []chat.HuddleTrackRequest{
			{UserID: r.member2, Kind: chat.HuddleTrackCamera},
			{UserID: r.member2, Kind: chat.HuddleTrackAudio, Quality: chat.HuddleQualityHigh},
			{UserID: r.member2, Kind: chat.HuddleTrackScreen, Quality: chat.HuddleQualityLow},
			{UserID: r.member2, Kind: "video"},
			{UserID: r.member2, Kind: chat.HuddleTrackCamera, Quality: "ultra"},
		} {
			_, err := env.Service.SubscribeHuddle(t.Context(), r.member, a.Huddle.ID, a.ParticipantID, []chat.HuddleTrackRequest{req})
			var ve *chat.ValidationError
			if !errors.As(err, &ve) {
				t.Errorf("SubscribeHuddle(%+v) = %v", req, err)
			}
		}
	})

	t.Run("受けているカメラの層を替える（SDP のやり取りなし。決定 6）", func(t *testing.T) {
		if err := env.Service.SetHuddleSubscriptionQuality(t.Context(), r.member, a.Huddle.ID, a.ParticipantID, "3", r.member2, chat.HuddleQualityLow); err != nil {
			t.Fatal(err)
		}
		qs := env.Media.Qualities()
		if len(qs) != 1 || !strings.HasSuffix(qs[0], "/3/camera/low") {
			t.Errorf("qualities = %v", qs)
		}
	})

	t.Run("カメラを付けていない人・自分の層は替えられない", func(t *testing.T) {
		for _, u := range []ulid.ULID{r.admin, r.member} {
			if err := env.Service.SetHuddleSubscriptionQuality(t.Context(), r.member, a.Huddle.ID, a.ParticipantID, "3", u, chat.HuddleQualityLow); !errors.Is(err, chat.ErrNotFound) {
				t.Errorf("SetHuddleSubscriptionQuality(%s) = %v", u, err)
			}
		}
		var ve *chat.ValidationError
		if err := env.Service.SetHuddleSubscriptionQuality(t.Context(), r.member, a.Huddle.ID, a.ParticipantID, "", r.member2, "ultra"); !errors.As(err, &ve) || len(ve.Fields) != 2 {
			t.Errorf("invalid input = %v", err)
		}
	})

	t.Run("カメラを止めた後は受けられない", func(t *testing.T) {
		if err := env.Service.UnpublishHuddleTrack(t.Context(), r.member2, b.Huddle.ID, b.ParticipantID, chat.HuddleTrackCamera); err != nil {
			t.Fatal(err)
		}
		got, err := env.Service.SubscribeHuddle(t.Context(), r.member, a.Huddle.ID, a.ParticipantID, []chat.HuddleTrackRequest{
			{UserID: r.member2, Kind: chat.HuddleTrackCamera, Quality: chat.HuddleQualityHigh},
		})
		if err != nil || len(got.Tracks) != 0 || got.Offer != nil {
			t.Errorf("subscribe stopped camera = %+v, %v", got, err)
		}
	})
}

// 権限が変わって外れたら、カメラと画面のトラックも閉じる（ルール 8。外すときはセッションのトラックを全部閉じる）。
// 外れた人は huddle.updated の参加者から消えるので、ほかの人の画面からも映像が消える。
func TestHuddleVideoRemovedOnKick(t *testing.T) {
	env := chattest.New(t)
	r, room := huddleRoom(t, env)
	joinHuddle(t, env, r.member, room.ID)
	b := joinHuddle(t, env, r.member2, room.ID)
	if _, err := env.Service.PublishHuddleTrack(t.Context(), r.member2, b.Huddle.ID, b.ParticipantID, chat.HuddleTrackCamera, chattest.Offer, "1"); err != nil {
		t.Fatal(err)
	}
	session := sessionOf(t, env, "camera", "1")
	env.Deliveries.Take()

	if err := env.Service.RemoveMember(t.Context(), r.owner, r.ws.ID, r.member2); err != nil {
		t.Fatal(err)
	}
	if !slices.Contains(env.Media.Closed(), session) {
		t.Errorf("closed sessions = %v, want %s", env.Media.Closed(), session)
	}
	updated := eventsOfType(env.Deliveries.Take(), chat.EventHuddleUpdated)
	if len(updated) == 0 || slices.Contains(huddleUserIDs(updated[len(updated)-1].Data.(chat.HuddleUpdated).Huddle), r.member2) {
		t.Errorf("huddle.updated = %+v", updated)
	}
}
