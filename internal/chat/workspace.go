package chat

import (
	"context"
	"encoding/base32"
	"fmt"
	"io"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat/authz"
	"github.com/shun2218-dev/hibari/internal/chat/store"
)

// slugBytes は slug の乱数のバイト数。秘密ではないが、衝突しない長さにする（64 ビット）。
const slugBytes = 8

// slugEncoding は URL に置いても紛らわしくない小文字の base32（パディングなし）。
var slugEncoding = base32.StdEncoding.WithPadding(base32.NoPadding)

// newSlug は URL 用の slug を作る。作成ダイアログは名前だけを受け取るので（docs/ui）、サーバーがランダムに決める。
// 日本語の名前から slug を作ると空や重複になりやすい。
func newSlug(random io.Reader) (string, error) {
	b := make([]byte, slugBytes)
	if _, err := io.ReadFull(random, b); err != nil {
		return "", fmt.Errorf("read random: %w", err)
	}
	return strings.ToLower(slugEncoding.EncodeToString(b)), nil
}

func toWorkspace(w store.Workspace, role string) Workspace {
	return Workspace{
		ID:           w.ID,
		Slug:         w.Slug,
		Name:         w.Name,
		InvitePolicy: InvitePolicy(w.InvitePolicy),
		MyRole:       Role(role),
		CreatedAt:    w.CreatedAt,
		UpdatedAt:    w.UpdatedAt,
	}
}

// CreateWorkspace はワークスペースを作り、actor を owner にする。デフォルトのルームは作らない（ADR 0011）。
func (s *Service) CreateWorkspace(ctx context.Context, actor ulid.ULID, name string) (Workspace, error) {
	var fields fieldErrors
	name = normalizeName(&fields, "name", name, workspaceNameMax)
	if err := fields.err(); err != nil {
		return Workspace{}, err
	}
	slug, err := newSlug(s.random)
	if err != nil {
		return Workspace{}, err
	}

	var ws Workspace
	err = s.inTx(ctx, func(tx pgx.Tx) error {
		q := store.New(tx)
		now := s.clock.Now()
		w, err := q.CreateWorkspace(ctx, store.CreateWorkspaceParams{
			ID:        s.ids.New(),
			Slug:      slug,
			Name:      name,
			CreatedBy: actor,
			Now:       now,
		})
		if err != nil {
			return fmt.Errorf("create workspace: %w", err)
		}
		if err := q.AddWorkspaceMember(ctx, store.AddWorkspaceMemberParams{
			WorkspaceID: w.ID,
			UserID:      actor,
			Role:        string(authz.RoleOwner),
			Now:         now,
		}); err != nil {
			return fmt.Errorf("add owner: %w", err)
		}
		ws = toWorkspace(w, string(authz.RoleOwner))
		ws.MemberCount = 1
		return nil
	})
	return ws, err
}

// ListWorkspaces は actor が所属するワークスペースを返す。サイドバーが全件を必要とするのでページングしない（ADR 0011）。
func (s *Service) ListWorkspaces(ctx context.Context, actor ulid.ULID) ([]Workspace, error) {
	rows, err := store.New(s.db).ListWorkspacesForUser(ctx, actor)
	if err != nil {
		return nil, fmt.Errorf("list workspaces: %w", err)
	}
	out := make([]Workspace, len(rows))
	for i, r := range rows {
		out[i] = toWorkspace(r.Workspace, r.Role)
	}
	return out, nil
}

// GetWorkspace はワークスペースを返す。actor がメンバーでなければ ErrNotFound。
func (s *Service) GetWorkspace(ctx context.Context, actor, workspaceID ulid.ULID) (Workspace, error) {
	return getWorkspace(ctx, store.New(s.db), actor, workspaceID)
}

func getWorkspace(ctx context.Context, q *store.Queries, actor, workspaceID ulid.ULID) (Workspace, error) {
	r, err := q.GetWorkspaceForUser(ctx, store.GetWorkspaceForUserParams{UserID: actor, ID: workspaceID})
	if err != nil {
		return Workspace{}, notFoundIfNoRows(err, "get workspace")
	}
	ws := toWorkspace(r.Workspace, r.Role)
	ws.MemberCount = r.MemberCount
	return ws, nil
}

// WorkspaceUpdate はワークスペースの変更。nil の項目は変更しない。
type WorkspaceUpdate struct {
	Name         *string
	InvitePolicy *string
}

// UpdateWorkspace は名前と invite_policy を変更する。admin 以上だけができる。
func (s *Service) UpdateWorkspace(ctx context.Context, actor, workspaceID ulid.ULID, in WorkspaceUpdate) (Workspace, error) {
	var fields fieldErrors
	params := store.UpdateWorkspaceParams{ID: workspaceID}
	if in.Name != nil {
		name := normalizeName(&fields, "name", *in.Name, workspaceNameMax)
		params.Name = &name
	}
	if in.InvitePolicy != nil {
		if _, ok := authz.ParseInvitePolicy(*in.InvitePolicy); !ok {
			fields.add("invite_policy", ReasonInvalidValue)
		}
		params.InvitePolicy = in.InvitePolicy
	}
	if err := fields.err(); err != nil {
		return Workspace{}, err
	}

	var (
		ws      Workspace
		updated bool
	)
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		q := store.New(tx)
		me, err := q.GetWorkspaceRoleForShare(ctx, store.GetWorkspaceRoleForShareParams{WorkspaceID: workspaceID, UserID: actor})
		if err != nil {
			return notFoundIfNoRows(err, "get role")
		}
		if !authz.CanUpdateWorkspace(Role(me.Role)) {
			return ErrForbidden
		}
		if params.Name != nil || params.InvitePolicy != nil {
			params.Now = s.clock.Now()
			if _, err := q.UpdateWorkspace(ctx, params); err != nil {
				return fmt.Errorf("update workspace: %w", err)
			}
			updated = true
		}
		ws, err = getWorkspace(ctx, q, actor, workspaceID)
		return err
	})
	if err != nil {
		return Workspace{}, err
	}
	if updated {
		s.deliver(ctx, Event{
			Type: EventWorkspaceUpdated,
			To:   Audience{Workspaces: []ulid.ULID{workspaceID}},
			Data: WorkspaceUpdated{WorkspaceID: workspaceID, Name: ws.Name, InvitePolicy: ws.InvitePolicy},
		})
	}
	return ws, nil
}
