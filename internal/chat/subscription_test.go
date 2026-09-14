package chat_test

import (
	"context"
	"errors"
	"testing"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat"
	"github.com/shun2218-dev/hibari/internal/chat/chattest"
)

func TestSubscriptionAuthorizer(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	auth := chat.NewSubscriptionAuthorizer(env.Pool)
	public := createRoom(t, env, r.member, r.ws.ID, "public", "public")
	private := createRoom(t, env, r.member, r.ws.ID, "private", "private")
	dm, _ := createDM(t, env, r.member, r.ws.ID, r.member2)
	unknown := env.IDs.New()

	t.Run("rooms", func(t *testing.T) {
		for _, tt := range []struct {
			name    string
			actor   ulid.ULID
			room    ulid.ULID
			wantErr error
		}{
			{"public as member", r.member, public.ID, nil},
			// public は参加していなくても読めるので購読できる（閲覧中の public ルーム）。
			{"public without joining", r.owner, public.ID, nil},
			{"private as member", r.member, private.ID, nil},
			{"private as non-member owner", r.owner, private.ID, chat.ErrNotFound},
			{"dm as participant", r.member2, dm.ID, nil},
			{"dm as owner", r.owner, dm.ID, chat.ErrNotFound},
			{"outsider", r.outsider, public.ID, chat.ErrNotFound},
			{"unknown room", r.member, unknown, chat.ErrNotFound},
		} {
			t.Run(tt.name, func(t *testing.T) {
				ws, err := auth.AuthorizeRoom(t.Context(), tt.actor, tt.room)
				if !errors.Is(err, tt.wantErr) {
					t.Fatalf("AuthorizeRoom() error = %v, want %v", err, tt.wantErr)
				}
				if err == nil && ws != r.ws.ID {
					t.Errorf("workspace = %s, want %s", ws, r.ws.ID)
				}
			})
		}
	})

	t.Run("workspaces", func(t *testing.T) {
		other := env.CreateWorkspace(t, r.outsider)
		for _, tt := range []struct {
			name    string
			actor   ulid.ULID
			ws      ulid.ULID
			wantErr error
		}{
			{"member", r.member, r.ws.ID, nil},
			{"owner", r.owner, r.ws.ID, nil},
			{"outsider", r.outsider, r.ws.ID, chat.ErrNotFound},
			{"someone else's workspace", r.member, other.ID, chat.ErrNotFound},
			{"unknown", r.member, unknown, chat.ErrNotFound},
		} {
			if err := auth.AuthorizeWorkspace(t.Context(), tt.actor, tt.ws); !errors.Is(err, tt.wantErr) {
				t.Errorf("%s: AuthorizeWorkspace() error = %v, want %v", tt.name, err, tt.wantErr)
			}
		}
		got, err := auth.WorkspaceIDs(t.Context(), r.outsider)
		if err != nil || !sameIDs(got, idList(other.ID)) {
			t.Errorf("WorkspaceIDs(outsider) = %v, %v; want [%s]", got, err, other.ID)
		}
	})

	t.Run("allowed", func(t *testing.T) {
		rooms, workspaces, err := auth.Allowed(t.Context(), r.owner, idList(public.ID, private.ID, dm.ID, unknown), idList(r.ws.ID, unknown))
		if err != nil {
			t.Fatal(err)
		}
		if !rooms[public.ID] || rooms[private.ID] || rooms[dm.ID] || rooms[unknown] || len(rooms) != 1 {
			t.Errorf("allowed rooms = %v, want only public", rooms)
		}
		if !workspaces[r.ws.ID] || len(workspaces) != 1 {
			t.Errorf("allowed workspaces = %v", workspaces)
		}
		if rooms, workspaces, err := auth.Allowed(t.Context(), r.owner, nil, nil); err != nil || len(rooms) != 0 || len(workspaces) != 0 {
			t.Errorf("Allowed(nil, nil) = %v, %v, %v", rooms, workspaces, err)
		}

		// キックされたら、どれも購読できなくなる（ワークスペースを抜けると room_members も消える）。
		if err := env.Service.RemoveMember(t.Context(), r.owner, r.ws.ID, r.member); err != nil {
			t.Fatal(err)
		}
		rooms, workspaces, err = auth.Allowed(t.Context(), r.member, idList(public.ID, private.ID, dm.ID), idList(r.ws.ID))
		if err != nil || len(rooms) != 0 || len(workspaces) != 0 {
			t.Errorf("after kick: rooms %v, workspaces %v, %v; want none", rooms, workspaces, err)
		}
	})

	t.Run("typing", func(t *testing.T) {
		if _, err := env.Service.JoinRoom(t.Context(), r.admin, public.ID); err != nil {
			t.Fatal(err)
		}
		got, err := auth.AuthorizeTyping(t.Context(), r.admin, public.ID)
		if err != nil || got.RoomID != public.ID || got.WorkspaceID != r.ws.ID || got.User.ID != r.admin || got.User.DisplayName == "" {
			t.Fatalf("AuthorizeTyping() = %+v, %v", got, err)
		}
		// 読めるが投稿できない（参加していない public）。
		if _, err := auth.AuthorizeTyping(t.Context(), r.admin2, public.ID); !errors.Is(err, chat.ErrForbidden) {
			t.Errorf("read-only error = %v, want ErrForbidden", err)
		}
		if _, err := auth.AuthorizeTyping(t.Context(), r.owner, dm.ID); !errors.Is(err, chat.ErrNotFound) {
			t.Errorf("unreadable error = %v, want ErrNotFound", err)
		}
	})
}

// presence の初期値を REST（ルームのメンバー一覧と dm_peer）で返す（ADR 0015）。
func TestPresenceInRoomResponses(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	room := createRoom(t, env, r.member, r.ws.ID, "public", "public")
	if _, err := env.Service.JoinRoom(t.Context(), r.member2, room.ID); err != nil {
		t.Fatal(err)
	}
	if err := env.Presence.SetOnline(t.Context(), r.member2); err != nil {
		t.Fatal(err)
	}
	// t.Context は Cleanup の前にキャンセルされるので使わない。
	t.Cleanup(func() { _ = env.Presence.SetOffline(context.Background(), r.member2) })

	page, err := env.Service.ListRoomMembers(t.Context(), r.member, room.ID, chat.PageRequest{})
	if err != nil {
		t.Fatal(err)
	}
	online := map[ulid.ULID]bool{}
	for _, m := range page.Items {
		online[m.User.ID] = m.Online
	}
	if len(online) != 2 || !online[r.member2] || online[r.member] {
		t.Errorf("room members online = %v, want only member2", online)
	}

	dm, _ := createDM(t, env, r.member, r.ws.ID, r.member2)
	if !dm.DMPeerOnline {
		t.Error("CreateRoom(dm) dm_peer is not online")
	}
	got, err := env.Service.GetRoom(t.Context(), r.member, dm.ID)
	if err != nil || !got.DMPeerOnline {
		t.Errorf("GetRoom(dm) dm_peer online = %v, %v", got.DMPeerOnline, err)
	}
	got, err = env.Service.GetRoom(t.Context(), r.member2, dm.ID)
	if err != nil || got.DMPeerOnline {
		t.Errorf("GetRoom(dm) from member2: peer online = %v, %v; want offline", got.DMPeerOnline, err)
	}
	rooms, err := env.Service.ListRooms(t.Context(), r.member, r.ws.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, rm := range rooms {
		if rm.ID == dm.ID && !rm.DMPeerOnline {
			t.Error("ListRooms dm_peer is not online")
		}
		if rm.ID == room.ID && rm.DMPeerOnline {
			t.Error("non-dm room has dm_peer online")
		}
	}
}
