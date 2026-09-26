package httpx

import (
	"net/http"
	"reflect"
)

// apiRoute は REST のエンドポイント 1 つ分の説明（ADR 0064 決定 5）。OpenAPI の paths はこの表から作る。
//
// 型はハンドラが decodeJSON / writeJSON に渡しているものと同じにする。
// 表の漏れは TestOpenAPIRoutesMatchSource がソースと照合して落とす（型の書き間違いまでは検査しないのでレビューで見る）。
type apiRoute struct {
	// pattern は ServeMux に登録しているパターン（"POST /api/v1/workspaces"）。
	pattern string
	// tag はサイドバーのまとまり（apiTags の名前）。
	tag string
	// summary は 1 行の要約。
	summary string
	// description は要約で足りないときの説明（任意）。
	description string
	auth        apiAuth
	// query はクエリのパラメータ。パスのパラメータは pattern の {name} から作る。
	query []apiParam
	// request はリクエストの本文の型。本文がなければ nil。
	request reflect.Type
	// requestOptional は本文を省略できること（Web クライアントは refresh の本文を送らず Cookie を使う、など）。
	requestOptional bool
	// status は成功したときのステータス。
	status int
	// response は成功したときの本文の型。本文がなければ nil（204 など）。
	response reflect.Type
	// rawMedia は、Go の型を通さずに書く本文の media type（JWKS）。スキーマは任意のオブジェクトにする。
	rawMedia string
	// errors は返しうるエラーのステータス。認証の 401 と、email を検証していない 403 は auth から、
	// 本文の Content-Type と大きさの 415 / 413 は request から足すので書かない。
	errors []int
}

type apiAuth int

const (
	// authNone は認証の要らないエンドポイント。
	authNone apiAuth = iota
	// authUser は Access Token が要る（requireAuth）。
	authUser
	// authChatUser は Access Token と、email の検証が要る（requireChatUser。ADR 0053）。
	authChatUser
)

type apiParam struct {
	name string
	// typ は "string" / "integer" / "boolean"。
	typ      string
	required bool
	// repeated は同じ名前で何度も渡せること（`?room_id=..&room_id=..`）。
	repeated    bool
	description string
}

func body[T any]() reflect.Type { return reflect.TypeFor[T]() }

// apiTags はタグの並びと説明。
var apiTags = []struct{ name, description string }{
	{"auth", "登録・ログイン・トークンの更新・email の確認・パスワードの再設定（ADR 0010）"},
	{"users", "自分のプロフィールとアバター"},
	{"sessions", "ログイン中のデバイス（ADR 0019）"},
	{"workspaces", "ワークスペース（ADR 0011）"},
	{"members", "ワークスペースのメンバー・ロール・owner の譲渡（ADR 0006 / 0011）"},
	{"presence", "手動の離席とカスタムステータス（ADR 0049）"},
	{"notifications", "通知の設定（ADR 0055 / 0056）"},
	{"invites", "招待リンク（ADR 0011）"},
	{"rooms", "ルームとルームのメンバー（ADR 0011 / 0059）"},
	{"messages", "メッセージの送信・一覧・編集・削除（ADR 0012）"},
	{"reactions", "絵文字のリアクション（ADR 0044）"},
	{"pins", "ピン留め（ADR 0054）"},
	{"saved", "「後で」（ADR 0054）"},
	{"threads", "スレッド（ADR 0036）"},
	{"read", "既読の位置（ADR 0025）"},
	{"search", "メッセージの検索（ADR 0061）"},
	{"activity", "アクティビティ（ADR 0058）"},
	{"attachments", "添付ファイル（ADR 0013）"},
	{"link-previews", "外部のリンクのプレビュー（ADR 0065）"},
	{"huddles", "音声のハドル（ADR 0066）"},
	{"websocket", "WebSocket の接続（docs/events.md）"},
	{"system", "ヘルスチェックと公開鍵"},
}

// apiRoutes は REST のエンドポイントの表。並びは OpenAPI の出力の順（タグの中）。
var apiRoutes = []apiRoute{
	// auth
	{
		pattern:     "POST /api/v1/auth/register",
		tag:         "auth",
		summary:     "アカウントを登録する",
		description: "登録と同時にログインする。X-Hibari-Client: web なら Refresh Token は httpOnly Cookie で渡し、本文には入れない（それ以外は本文の refresh_token）。",
		auth:        authNone,
		request:     body[registerRequest](),
		status:      http.StatusCreated, response: body[tokenResponse](),
		errors: []int{http.StatusBadRequest, http.StatusConflict, http.StatusUnprocessableEntity, http.StatusTooManyRequests},
	},
	{
		pattern:     "POST /api/v1/auth/login",
		tag:         "auth",
		summary:     "ログインする",
		description: "email とパスワードのどちらが違うかは区別しない。X-Hibari-Client: web なら Refresh Token は httpOnly Cookie で渡し、本文には入れない（それ以外は本文の refresh_token）。",
		auth:        authNone,
		request:     body[loginRequest](),
		status:      http.StatusOK, response: body[tokenResponse](),
		errors: []int{http.StatusBadRequest, http.StatusUnauthorized, http.StatusTooManyRequests},
	},
	{
		pattern:         "POST /api/v1/auth/refresh",
		tag:             "auth",
		summary:         "トークンを更新する（Refresh Token のローテーション）",
		description:     "user は返さない。X-Hibari-Client: web なら Refresh Token を Cookie から読んで新しい Cookie に差し替え（本文は送らない）、それ以外は本文で受け渡す。使えないトークンなら Cookie を消させる。",
		auth:            authNone,
		request:         body[refreshTokenRequest](),
		requestOptional: true,
		status:          http.StatusOK, response: body[tokenResponse](),
		errors: []int{http.StatusBadRequest, http.StatusUnauthorized},
	},
	{
		pattern:         "POST /api/v1/auth/logout",
		tag:             "auth",
		summary:         "ログアウトする（そのセッションだけを失効させる）",
		description:     "トークンが見つからない・失効済みでも 204。X-Hibari-Client: web なら Refresh Token を Cookie から読んで Cookie を消させ（本文は送らない）、それ以外は本文で受け取る。",
		auth:            authNone,
		request:         body[refreshTokenRequest](),
		requestOptional: true,
		status:          http.StatusNoContent, response: nil,
		errors: []int{http.StatusBadRequest},
	},
	{
		pattern:         "POST /api/v1/auth/verify-email/request",
		tag:             "auth",
		summary:         "確認メールを送り直す",
		description:     "本文は省略できる。確認済みでも同じ 202 を返す（状態は GET /users/me で見る）。",
		auth:            authUser,
		request:         body[emailVerificationRequest](),
		requestOptional: true,
		status:          http.StatusAccepted, response: nil,
		errors: []int{http.StatusBadRequest, http.StatusUnprocessableEntity, http.StatusTooManyRequests},
	},
	{
		pattern: "POST /api/v1/auth/verify-email/confirm",
		tag:     "auth",
		summary: "email を確認する（ワンタイムトークンを使う）",
		auth:    authNone,
		request: body[oneTimeTokenRequest](),
		status:  http.StatusNoContent, response: nil,
		errors: []int{http.StatusBadRequest},
	},
	{
		pattern:     "POST /api/v1/auth/password-reset/request",
		tag:         "auth",
		summary:     "パスワードの再設定メールを送る",
		description: "アカウントの有無に関係なく 202 を返す。",
		auth:        authNone,
		request:     body[passwordResetRequest](),
		status:      http.StatusAccepted, response: nil,
		errors: []int{http.StatusBadRequest, http.StatusTooManyRequests},
	},
	{
		pattern:     "POST /api/v1/auth/password-reset/confirm",
		tag:         "auth",
		summary:     "パスワードを再設定する",
		description: "そのユーザーの全セッションが失効するので、クライアントはログインし直す。",
		auth:        authNone,
		request:     body[passwordResetConfirmRequest](),
		status:      http.StatusNoContent, response: nil,
		errors: []int{http.StatusBadRequest, http.StatusUnprocessableEntity},
	},

	// users
	{
		pattern: "GET /api/v1/users/me",
		tag:     "users",
		summary: "自分のアカウント",
		auth:    authUser,
		status:  http.StatusOK, response: body[userResponse](),
	},
	{
		pattern:     "PATCH /api/v1/users/me",
		tag:         "users",
		summary:     "表示名とハンドルを変える",
		description: "省略した項目（と null）は変えない。",
		auth:        authUser,
		request:     body[updateProfileRequest](),
		status:      http.StatusOK, response: body[userResponse](),
		errors: []int{http.StatusBadRequest, http.StatusConflict, http.StatusUnprocessableEntity},
	},
	{
		pattern:     "POST /api/v1/users/me/avatar",
		tag:         "users",
		summary:     "アバター画像のアップロード先（署名付き URL）を発行する",
		description: "画像はストレージに直接 PUT する。申告した content_type と size_bytes は署名に含まれる。",
		auth:        authUser,
		request:     body[avatarUploadRequest](),
		status:      http.StatusCreated, response: body[avatarUploadResponse](),
		errors: []int{http.StatusBadRequest, http.StatusUnprocessableEntity},
	},
	{
		pattern: "POST /api/v1/users/me/avatar/complete",
		tag:     "users",
		summary: "アップロードしたアバター画像を確かめて設定する",
		auth:    authUser,
		request: body[completeAvatarUploadRequest](),
		status:  http.StatusOK, response: body[userResponse](),
		errors: []int{http.StatusBadRequest, http.StatusConflict, http.StatusUnprocessableEntity},
	},
	{
		pattern: "DELETE /api/v1/users/me/avatar",
		tag:     "users",
		summary: "アバター画像を外す",
		auth:    authUser,
		status:  http.StatusOK, response: body[userResponse](),
	},
	{
		pattern:     "POST /api/v1/users/avatars",
		tag:         "users",
		summary:     "ユーザーのアバターの URL をまとめて取る",
		description: "画像を持たないユーザーと、ID として読めない値は結果に入らない。user_ids は 200 件まで。",
		auth:        authUser,
		request:     body[avatarURLsRequest](),
		status:      http.StatusOK, response: body[avatarURLsResponse](),
		errors: []int{http.StatusBadRequest, http.StatusUnprocessableEntity},
	},

	// sessions
	{
		pattern: "GET /api/v1/auth/sessions",
		tag:     "sessions",
		summary: "ログイン中のデバイスの一覧",
		auth:    authUser,
		status:  http.StatusOK, response: body[sessionListResponse](),
	},
	{
		pattern: "DELETE /api/v1/auth/sessions",
		tag:     "sessions",
		summary: "いま使っているセッション以外をすべて失効させる",
		auth:    authUser,
		status:  http.StatusOK, response: body[revokeSessionsResponse](),
	},
	{
		pattern:     "DELETE /api/v1/auth/sessions/{sessionID}",
		tag:         "sessions",
		summary:     "セッションを 1 つ失効させる",
		description: "他人のセッションの ID は、存在しないものと区別せず 404 にする。",
		auth:        authUser,
		status:      http.StatusNoContent, response: nil,
		errors: []int{http.StatusNotFound},
	},

	// workspaces
	{
		pattern: "POST /api/v1/workspaces",
		tag:     "workspaces",
		summary: "ワークスペースを作る",
		auth:    authChatUser,
		request: body[createWorkspaceRequest](),
		status:  http.StatusCreated, response: body[workspaceResponse](),
		errors: []int{http.StatusBadRequest, http.StatusUnprocessableEntity},
	},
	{
		pattern:     "GET /api/v1/workspaces",
		tag:         "workspaces",
		summary:     "参加しているワークスペースの一覧",
		description: "member_count は入らない。",
		auth:        authChatUser,
		status:      http.StatusOK, response: body[workspaceListResponse](),
	},
	{
		pattern: "GET /api/v1/workspaces/{workspaceID}",
		tag:     "workspaces",
		summary: "ワークスペースを 1 件取る",
		auth:    authChatUser,
		status:  http.StatusOK, response: body[workspaceResponse](),
		errors: []int{http.StatusNotFound},
	},
	{
		pattern:     "PATCH /api/v1/workspaces/{workspaceID}",
		tag:         "workspaces",
		summary:     "ワークスペースの名前と招待の方針を変える",
		description: "省略した項目（と null）は変えない。",
		auth:        authChatUser,
		request:     body[updateWorkspaceRequest](),
		status:      http.StatusOK, response: body[workspaceResponse](),
		errors: []int{http.StatusBadRequest, http.StatusForbidden, http.StatusNotFound, http.StatusUnprocessableEntity},
	},

	// members
	{
		pattern: "GET /api/v1/workspaces/{workspaceID}/members",
		tag:     "members",
		summary: "ワークスペースのメンバーの一覧",
		auth:    authChatUser,
		query: []apiParam{
			{name: "after", typ: "string", description: "前のページの next_cursor"},
			{name: "limit", typ: "integer", description: "件数（最大 200、既定 100）"},
		},
		status: http.StatusOK, response: body[memberListResponse](),
		errors: []int{http.StatusBadRequest, http.StatusNotFound},
	},
	{
		pattern:     "GET /api/v1/workspaces/{workspaceID}/members/{userID}",
		tag:         "members",
		summary:     "メンバーのプロフィール",
		description: "email を返すのはこの API だけで、検証済みのときだけ入る（ADR 0050）。",
		auth:        authChatUser,
		status:      http.StatusOK, response: body[memberProfileResponse](),
		errors: []int{http.StatusNotFound},
	},
	{
		pattern: "PATCH /api/v1/workspaces/{workspaceID}/members/{userID}",
		tag:     "members",
		summary: "メンバーのロールを変える",
		auth:    authChatUser,
		request: body[changeMemberRoleRequest](),
		status:  http.StatusOK, response: body[memberResponse](),
		errors: []int{http.StatusBadRequest, http.StatusForbidden, http.StatusNotFound, http.StatusUnprocessableEntity},
	},
	{
		pattern:     "DELETE /api/v1/workspaces/{workspaceID}/members/{userID}",
		tag:         "members",
		summary:     "メンバーをキックする（自分なら退出）",
		description: "owner は退出できない（先に譲渡する。409）。",
		auth:        authChatUser,
		status:      http.StatusNoContent, response: nil,
		errors: []int{http.StatusForbidden, http.StatusNotFound, http.StatusConflict},
	},
	{
		pattern:     "POST /api/v1/workspaces/{workspaceID}/ownership-transfer",
		tag:         "members",
		summary:     "owner を譲渡する",
		description: "owner は常に 1 人で、昇格ではなく譲渡で移す。",
		auth:        authChatUser,
		request:     body[transferOwnershipRequest](),
		status:      http.StatusNoContent, response: nil,
		errors: []int{http.StatusBadRequest, http.StatusForbidden, http.StatusNotFound, http.StatusUnprocessableEntity},
	},

	// presence
	{
		pattern:     "PUT /api/v1/users/me/presence",
		tag:         "presence",
		summary:     "手動の離席を固定する / 解除する",
		description: "ユーザーごと（ワークスペースをまたぐ）。冪等。",
		auth:        authChatUser,
		request:     body[manualAwayRequest](),
		status:      http.StatusOK, response: body[manualAwayResponse](),
		errors: []int{http.StatusBadRequest},
	},
	{
		pattern:     "PUT /api/v1/workspaces/{workspaceID}/me/status",
		tag:         "presence",
		summary:     "カスタムステータスを設定する",
		description: "expires_at が null なら消えない。相対の期限を絶対の時刻にするのはクライアント。",
		auth:        authChatUser,
		request:     body[setStatusRequest](),
		status:      http.StatusOK, response: body[userStatusResponse](),
		errors: []int{http.StatusBadRequest, http.StatusNotFound, http.StatusUnprocessableEntity},
	},
	{
		pattern: "DELETE /api/v1/workspaces/{workspaceID}/me/status",
		tag:     "presence",
		summary: "カスタムステータスを消す",
		auth:    authChatUser,
		status:  http.StatusNoContent, response: nil,
		errors: []int{http.StatusNotFound},
	},

	// notifications
	{
		pattern: "GET /api/v1/workspaces/{workspaceID}/me/notifications",
		tag:     "notifications",
		summary: "ワークスペース全体の通知の設定",
		auth:    authChatUser,
		status:  http.StatusOK, response: body[notificationLevelBody](),
		errors: []int{http.StatusNotFound},
	},
	{
		pattern: "PUT /api/v1/workspaces/{workspaceID}/me/notifications",
		tag:     "notifications",
		summary: "ワークスペース全体の通知の設定を変える",
		auth:    authChatUser,
		request: body[notificationLevelBody](),
		status:  http.StatusOK, response: body[notificationLevelBody](),
		errors: []int{http.StatusBadRequest, http.StatusForbidden, http.StatusNotFound, http.StatusUnprocessableEntity},
	},
	{
		pattern:     "PUT /api/v1/rooms/{roomID}/me/notifications",
		tag:         "notifications",
		summary:     "ルームごとの通知の上書きとミュートを設定する",
		description: "全部の値の置き換えで、省いた値は既定（上書きなし・ミュートなし）になる。",
		auth:        authChatUser,
		request:     body[roomNotificationsBody](),
		status:      http.StatusOK, response: body[roomNotificationsBody](),
		errors: []int{http.StatusBadRequest, http.StatusForbidden, http.StatusNotFound, http.StatusUnprocessableEntity},
	},
	{
		pattern:     "PUT /api/v1/rooms/{roomID}/threads/{rootID}/me/notifications",
		tag:         "notifications",
		summary:     "スレッドの返信の通知を設定する",
		description: "true は明示的なフォローを兼ねる（ADR 0056）。",
		auth:        authChatUser,
		request:     body[threadNotificationsRequest](),
		status:      http.StatusOK, response: body[threadNotificationsResponse](),
		errors: []int{http.StatusBadRequest, http.StatusForbidden, http.StatusNotFound, http.StatusUnprocessableEntity},
	},

	// invites
	{
		pattern:     "POST /api/v1/workspaces/{workspaceID}/invites",
		tag:         "invites",
		summary:     "招待リンクを作る",
		description: "code が入るのはこの応答だけ（サーバーはハッシュしか持たない）。",
		auth:        authChatUser,
		request:     body[createInviteRequest](),
		status:      http.StatusCreated, response: body[inviteResponse](),
		errors: []int{http.StatusBadRequest, http.StatusForbidden, http.StatusNotFound, http.StatusUnprocessableEntity},
	},
	{
		pattern: "GET /api/v1/workspaces/{workspaceID}/invites",
		tag:     "invites",
		summary: "招待リンクの一覧",
		auth:    authChatUser,
		query: []apiParam{
			{name: "after", typ: "string", description: "前のページの next_cursor"},
			{name: "limit", typ: "integer", description: "件数（最大 200、既定 100）"},
		},
		status: http.StatusOK, response: body[inviteListResponse](),
		errors: []int{http.StatusBadRequest, http.StatusForbidden, http.StatusNotFound},
	},
	{
		pattern: "DELETE /api/v1/workspaces/{workspaceID}/invites/{inviteID}",
		tag:     "invites",
		summary: "招待リンクを無効にする",
		auth:    authChatUser,
		status:  http.StatusNoContent, response: nil,
		errors: []int{http.StatusForbidden, http.StatusNotFound},
	},
	{
		pattern:     "GET /api/v1/invites/{code}",
		tag:         "invites",
		summary:     "招待リンクの中身を見る（受け入れる前の確認）",
		description: "使えないリンクは 404、期限切れと使用回数の上限は 410。",
		auth:        authChatUser,
		status:      http.StatusOK, response: body[invitePreviewResponse](),
		errors: []int{http.StatusNotFound, http.StatusGone},
	},
	{
		pattern:     "POST /api/v1/invites/{code}/accept",
		tag:         "invites",
		summary:     "招待を受け入れる",
		description: "ワークスペースと is_default のルームに参加する。すでにメンバーでも 200（already_member で分かる）。",
		auth:        authChatUser,
		status:      http.StatusOK, response: body[inviteAcceptanceResponse](),
		errors: []int{http.StatusNotFound, http.StatusGone},
	},

	// rooms
	{
		pattern:     "POST /api/v1/workspaces/{workspaceID}/rooms",
		tag:         "rooms",
		summary:     "ルームを作る（public / private / dm）",
		description: "新しく作ったら 201、同じ 2 人の既存の DM を返したら 200。",
		auth:        authChatUser,
		request:     body[createRoomRequest](),
		status:      http.StatusCreated, response: body[roomResponse](),
		errors: []int{http.StatusBadRequest, http.StatusForbidden, http.StatusNotFound, http.StatusConflict, http.StatusUnprocessableEntity},
	},
	{
		pattern:     "GET /api/v1/workspaces/{workspaceID}/rooms",
		tag:         "rooms",
		summary:     "ワークスペースのルームの一覧（サイドバー）",
		description: "参加していない public ルームも入る。member_count は入らない。",
		auth:        authChatUser,
		status:      http.StatusOK, response: body[roomListResponse](),
		errors: []int{http.StatusNotFound},
	},
	{
		pattern: "GET /api/v1/rooms/{roomID}",
		tag:     "rooms",
		summary: "ルームを 1 件取る",
		auth:    authChatUser,
		status:  http.StatusOK, response: body[roomResponse](),
		errors: []int{http.StatusNotFound},
	},
	{
		pattern:     "PATCH /api/v1/rooms/{roomID}",
		tag:         "rooms",
		summary:     "ルームの名前と is_default を変える",
		description: "省略した項目（と null）は変えない。",
		auth:        authChatUser,
		request:     body[updateRoomRequest](),
		status:      http.StatusOK, response: body[roomResponse](),
		errors: []int{http.StatusBadRequest, http.StatusForbidden, http.StatusNotFound, http.StatusConflict, http.StatusUnprocessableEntity},
	},
	{
		pattern:     "DELETE /api/v1/rooms/{roomID}",
		tag:         "rooms",
		summary:     "ルームを削除する（元に戻せない）",
		description: "DM と既定のルームは削除できない（422）。",
		auth:        authChatUser,
		status:      http.StatusNoContent, response: nil,
		errors: []int{http.StatusForbidden, http.StatusNotFound, http.StatusUnprocessableEntity},
	},
	{
		pattern:     "POST /api/v1/rooms/{roomID}/archive",
		tag:         "rooms",
		summary:     "ルームをアーカイブする",
		description: "すでにアーカイブ中なら 409。DM と既定のルームはアーカイブできない（422）。",
		auth:        authChatUser,
		status:      http.StatusOK, response: body[roomResponse](),
		errors: []int{http.StatusForbidden, http.StatusNotFound, http.StatusConflict, http.StatusUnprocessableEntity},
	},
	{
		pattern:     "POST /api/v1/rooms/{roomID}/unarchive",
		tag:         "rooms",
		summary:     "アーカイブしたルームを戻す",
		description: "アーカイブされていなければ 409。",
		auth:        authChatUser,
		status:      http.StatusOK, response: body[roomResponse](),
		errors: []int{http.StatusForbidden, http.StatusNotFound, http.StatusConflict, http.StatusUnprocessableEntity},
	},
	{
		pattern:     "POST /api/v1/rooms/{roomID}/join",
		tag:         "rooms",
		summary:     "public ルームに参加する",
		description: "すでにメンバーでも 200。",
		auth:        authChatUser,
		status:      http.StatusOK, response: body[roomResponse](),
		errors: []int{http.StatusForbidden, http.StatusNotFound, http.StatusConflict},
	},
	{
		pattern: "GET /api/v1/rooms/{roomID}/members",
		tag:     "rooms",
		summary: "ルームのメンバーの一覧",
		auth:    authChatUser,
		query: []apiParam{
			{name: "after", typ: "string", description: "前のページの next_cursor"},
			{name: "limit", typ: "integer", description: "件数（最大 200、既定 100）"},
		},
		status: http.StatusOK, response: body[roomMemberListResponse](),
		errors: []int{http.StatusBadRequest, http.StatusNotFound},
	},
	{
		pattern:     "POST /api/v1/rooms/{roomID}/members",
		tag:         "rooms",
		summary:     "ルームにメンバーを加える",
		description: "ワークスペースのメンバーでない人は 422。DM には加えられない。",
		auth:        authChatUser,
		request:     body[addRoomMemberRequest](),
		status:      http.StatusNoContent, response: nil,
		errors: []int{http.StatusBadRequest, http.StatusForbidden, http.StatusNotFound, http.StatusConflict, http.StatusUnprocessableEntity},
	},
	{
		pattern: "DELETE /api/v1/rooms/{roomID}/members/{userID}",
		tag:     "rooms",
		summary: "ルームから外す（自分なら退出）",
		auth:    authChatUser,
		status:  http.StatusNoContent, response: nil,
		errors: []int{http.StatusForbidden, http.StatusNotFound, http.StatusConflict},
	},

	// messages
	{
		pattern:     "POST /api/v1/rooms/{roomID}/messages",
		tag:         "messages",
		summary:     "メッセージを送る（thread_root_id を付けるとスレッドの返信）",
		description: "新しく作ったら 201、同じ client_msg_id の再送なら既存のメッセージを 200 で返す（冪等）。アーカイブ中のルームは 409。",
		auth:        authChatUser,
		request:     body[sendMessageRequest](),
		status:      http.StatusCreated, response: body[messageResponse](),
		errors: []int{http.StatusBadRequest, http.StatusForbidden, http.StatusNotFound, http.StatusConflict, http.StatusUnprocessableEntity},
	},
	{
		pattern:     "GET /api/v1/rooms/{roomID}/messages",
		tag:         "messages",
		summary:     "メッセージの一覧（after_seq / before_seq で差分と過去を取る）",
		description: "messages は seq の昇順。after_change_seq のときだけ change_seq の昇順（再接続の差分取得。ADR 0014）。",
		auth:        authChatUser,
		query: []apiParam{
			{name: "before_seq", typ: "integer", description: "この seq より古いページ"},
			{name: "after_seq", typ: "integer", description: "この seq より新しいページ"},
			{name: "after_change_seq", typ: "integer", description: "この change_seq より後に作られた・変わったメッセージ（再接続の差分）"},
			{name: "around_message_id", typ: "string", description: "このメッセージの前後のページ（ADR 0042）。見つからなければ最新のページ"},
			{name: "limit", typ: "integer", description: "件数（最大 100、既定 50）"},
		},
		status: http.StatusOK, response: body[messageListResponse](),
		errors: []int{http.StatusBadRequest, http.StatusNotFound, http.StatusUnprocessableEntity},
	},
	{
		pattern:     "POST /api/v1/messages/links",
		tag:         "messages",
		summary:     "本文に貼られたメッセージのリンクのカードをまとめて取る",
		description: "見る人の権限で解決し、読めない・存在しないリンクは status で区別せずに返す（ADR 0040）。links は 20 件まで。",
		auth:        authChatUser,
		request:     body[messageLinksRequest](),
		status:      http.StatusOK, response: body[messageLinksResponse](),
		errors: []int{http.StatusBadRequest, http.StatusUnprocessableEntity},
	},
	{
		pattern:     "PATCH /api/v1/rooms/{roomID}/messages/{messageID}",
		tag:         "messages",
		summary:     "メッセージを編集する",
		description: "削除済みのメッセージは 409。",
		auth:        authChatUser,
		request:     body[editMessageRequest](),
		status:      http.StatusOK, response: body[messageResponse](),
		errors: []int{http.StatusBadRequest, http.StatusForbidden, http.StatusNotFound, http.StatusConflict, http.StatusUnprocessableEntity},
	},
	{
		pattern:     "DELETE /api/v1/rooms/{roomID}/messages/{messageID}",
		tag:         "messages",
		summary:     "メッセージを削除する（論理削除）",
		description: "削除済みでも 204。",
		auth:        authChatUser,
		status:      http.StatusNoContent, response: nil,
		errors: []int{http.StatusForbidden, http.StatusNotFound, http.StatusConflict},
	},

	// reactions
	{
		pattern:     "PUT /api/v1/rooms/{roomID}/messages/{messageID}/reactions/{emoji}",
		tag:         "reactions",
		summary:     "絵文字のリアクションを付ける",
		description: "emoji はパーセントエンコードする。すでに付いていても 200 で現在のメッセージを返す（冪等）。",
		auth:        authChatUser,
		status:      http.StatusOK, response: body[messageResponse](),
		errors: []int{http.StatusForbidden, http.StatusNotFound, http.StatusConflict, http.StatusUnprocessableEntity},
	},
	{
		pattern:     "DELETE /api/v1/rooms/{roomID}/messages/{messageID}/reactions/{emoji}",
		tag:         "reactions",
		summary:     "絵文字のリアクションを外す",
		description: "付いていなくても 200 で現在のメッセージを返す（冪等）。",
		auth:        authChatUser,
		status:      http.StatusOK, response: body[messageResponse](),
		errors: []int{http.StatusForbidden, http.StatusNotFound, http.StatusConflict, http.StatusUnprocessableEntity},
	},

	// pins
	{
		pattern:     "PUT /api/v1/rooms/{roomID}/messages/{messageID}/pin",
		tag:         "pins",
		summary:     "メッセージをピン留めする",
		description: "すでにピン留め済みでも 200（冪等）。ルームごとに 100 件まで。",
		auth:        authChatUser,
		status:      http.StatusOK, response: body[messageResponse](),
		errors: []int{http.StatusForbidden, http.StatusNotFound, http.StatusConflict, http.StatusUnprocessableEntity},
	},
	{
		pattern:     "DELETE /api/v1/rooms/{roomID}/messages/{messageID}/pin",
		tag:         "pins",
		summary:     "ピンを外す",
		description: "ピン留めされていなくても 200（冪等）。",
		auth:        authChatUser,
		status:      http.StatusOK, response: body[messageResponse](),
		errors: []int{http.StatusForbidden, http.StatusNotFound, http.StatusConflict, http.StatusUnprocessableEntity},
	},
	{
		pattern:     "GET /api/v1/rooms/{roomID}/pins",
		tag:         "pins",
		summary:     "ルームのピン留めの一覧（ピン留めした時刻の新しい順）",
		description: "上限が 100 件なのでページングしない。",
		auth:        authChatUser,
		status:      http.StatusOK, response: body[pinListResponse](),
		errors: []int{http.StatusNotFound},
	},

	// saved
	{
		pattern:     "PUT /api/v1/rooms/{roomID}/messages/{messageID}/saved",
		tag:         "saved",
		summary:     "メッセージを「後で」に保存する",
		description: "保存済みなら状態を変えずに 200（冪等）。",
		auth:        authChatUser,
		status:      http.StatusOK, response: body[savedItemResponse](),
		errors: []int{http.StatusNotFound},
	},
	{
		pattern:     "PATCH /api/v1/workspaces/{workspaceID}/saved/{messageID}",
		tag:         "saved",
		summary:     "保存をタブの間で動かす",
		description: "読めなくなったメッセージの保存でも動かせる。",
		auth:        authChatUser,
		request:     body[moveSavedRequest](),
		status:      http.StatusOK, response: body[savedItemResponse](),
		errors: []int{http.StatusBadRequest, http.StatusNotFound, http.StatusUnprocessableEntity},
	},
	{
		pattern:     "DELETE /api/v1/workspaces/{workspaceID}/saved/{messageID}",
		tag:         "saved",
		summary:     "「後で」から外す",
		description: "保存していなくても 204（冪等）。",
		auth:        authChatUser,
		status:      http.StatusNoContent, response: nil,
		errors: []int{http.StatusNotFound},
	},
	{
		pattern:     "GET /api/v1/workspaces/{workspaceID}/saved",
		tag:         "saved",
		summary:     "「後で」の一覧（after_change_seq で再接続の差分）",
		description: "state / before でタブの一覧、after_change_seq で再接続の差分を返す。",
		auth:        authChatUser,
		query: []apiParam{
			{name: "state", typ: "string", description: "タブ（in_progress / archived / completed。既定 in_progress）"},
			{name: "before", typ: "string", description: "この保存の ID より前のページ"},
			{name: "after_change_seq", typ: "integer", description: "この変更番号より後の差分"},
			{name: "limit", typ: "integer", description: "件数（最大 100、既定 50）"},
		},
		status: http.StatusOK, response: body[savedListResponse](),
		errors: []int{http.StatusBadRequest, http.StatusNotFound, http.StatusUnprocessableEntity},
	},

	// threads
	{
		pattern:     "GET /api/v1/rooms/{roomID}/threads/{rootID}/messages",
		tag:         "threads",
		summary:     "スレッドの親と返信の一覧（seq の昇順）",
		description: "返信の送信・編集・削除はメッセージの API（thread_root_id）を使う。",
		auth:        authChatUser,
		query: []apiParam{
			{name: "before_seq", typ: "integer", description: "この seq より古い返信"},
			{name: "after_seq", typ: "integer", description: "この seq より新しい返信"},
			{name: "around_message_id", typ: "string", description: "この返信の前後のページ（ADR 0042）"},
			{name: "limit", typ: "integer", description: "件数（最大 100、既定 50）"},
		},
		status: http.StatusOK, response: body[threadMessageListResponse](),
		errors: []int{http.StatusBadRequest, http.StatusNotFound, http.StatusUnprocessableEntity},
	},
	{
		pattern: "GET /api/v1/workspaces/{workspaceID}/threads",
		tag:     "threads",
		summary: "参加しているスレッドの一覧（最後の返信が新しい順）",
		auth:    authChatUser,
		query: []apiParam{
			{name: "after", typ: "string", description: "前のページの next_cursor"},
			{name: "limit", typ: "integer", description: "件数（最大 200、既定 100）"},
		},
		status: http.StatusOK, response: body[threadListResponse](),
		errors: []int{http.StatusBadRequest, http.StatusNotFound},
	},

	// read
	{
		pattern:     "POST /api/v1/rooms/{roomID}/read",
		tag:         "read",
		summary:     "ルームの既読位置を進める",
		description: "seq は必須。切り詰めた後の既読位置と未読数を返す。",
		auth:        authChatUser,
		request:     body[markRoomReadRequest](),
		status:      http.StatusOK, response: body[readStateResponse](),
		errors: []int{http.StatusBadRequest, http.StatusForbidden, http.StatusNotFound, http.StatusUnprocessableEntity},
	},
	{
		pattern:     "POST /api/v1/rooms/{roomID}/threads/{rootID}/read",
		tag:         "read",
		summary:     "スレッドの既読位置を進める",
		description: "受け取った seq 以下で最後の返信まで進める。seq は必須。",
		auth:        authChatUser,
		request:     body[markRoomReadRequest](),
		status:      http.StatusOK, response: body[threadReadStateResponse](),
		errors: []int{http.StatusBadRequest, http.StatusForbidden, http.StatusNotFound, http.StatusUnprocessableEntity},
	},

	// search
	{
		pattern:     "GET /api/v1/workspaces/{workspaceID}/search/messages",
		tag:         "search",
		summary:     "メッセージを検索する（新しい順）",
		description: "修飾子（in: / from: / before:）はクライアントが ID と日時にしてから渡す。総件数は返さない。",
		auth:        authChatUser,
		query: []apiParam{
			{name: "q", typ: "string", description: "検索語（引用符と除外を解釈する）"},
			{name: "cursor", typ: "string", description: "前のページの next_cursor"},
			{name: "room_id", typ: "string", repeated: true, description: "このルームに絞る"},
			{name: "exclude_room_id", typ: "string", repeated: true, description: "このルームを除く"},
			{name: "sender_id", typ: "string", repeated: true, description: "この送信者に絞る"},
			{name: "exclude_sender_id", typ: "string", repeated: true, description: "この送信者を除く"},
			{name: "after", typ: "string", description: "この日時より後（RFC 3339）"},
			{name: "before", typ: "string", description: "この日時より前（RFC 3339）"},
			{name: "limit", typ: "integer", description: "件数（最大 50、既定 20。超えると 422）"},
		},
		status: http.StatusOK, response: body[searchResponse](),
		errors: []int{http.StatusBadRequest, http.StatusNotFound, http.StatusUnprocessableEntity},
	},

	// activity
	{
		pattern: "GET /api/v1/workspaces/{workspaceID}/activity",
		tag:     "activity",
		summary: "アクティビティの一覧",
		auth:    authChatUser,
		query: []apiParam{
			{name: "filter", typ: "string", description: "タブ（all / dm / mention / thread / reaction。既定 all）"},
			{name: "unread", typ: "boolean", description: "true なら未読だけ"},
			{name: "before", typ: "string", description: "前のページの next_cursor"},
			{name: "limit", typ: "integer", description: "件数（最大 100、既定 50）"},
		},
		status: http.StatusOK, response: body[activityListResponse](),
		errors: []int{http.StatusBadRequest, http.StatusNotFound, http.StatusUnprocessableEntity},
	},
	{
		pattern:     "GET /api/v1/workspaces/{workspaceID}/activity/unread_count",
		tag:         "activity",
		summary:     "未読のアクティビティの件数（メニューのバッジ）",
		description: "100 で打ち切る。",
		auth:        authChatUser,
		status:      http.StatusOK, response: body[activityUnreadCountResponse](),
		errors: []int{http.StatusNotFound},
	},

	// attachments
	{
		pattern:     "POST /api/v1/rooms/{roomID}/attachments",
		tag:         "attachments",
		summary:     "添付ファイルのアップロード先（署名付き URL）を発行する",
		description: "pending の添付を作る。ファイルはストレージに直接 PUT し、complete で確かめてからメッセージに付ける。",
		auth:        authChatUser,
		request:     body[createAttachmentRequest](),
		status:      http.StatusCreated, response: body[createAttachmentResponse](),
		errors: []int{http.StatusBadRequest, http.StatusForbidden, http.StatusNotFound, http.StatusConflict, http.StatusUnprocessableEntity},
	},
	{
		pattern:     "DELETE /api/v1/rooms/{roomID}/messages/{messageID}/attachments/{attachmentID}",
		tag:         "attachments",
		summary:     "メッセージを残したまま添付ファイルだけを削除する",
		description: "応答は更新後のメッセージ（最後の 1 件を消して本文も空なら tombstone）。すでに消えていても 200（冪等）。",
		auth:        authChatUser,
		status:      http.StatusOK, response: body[messageResponse](),
		errors: []int{http.StatusForbidden, http.StatusNotFound, http.StatusConflict},
	},
	// link-previews
	{
		pattern:     "POST /api/v1/rooms/{roomID}/link-previews",
		tag:         "link-previews",
		summary:     "入力欄のリンクのプレビューを取る",
		description: "送る前に、入力欄の URL のカードを取る（その場で取りに行くので最大 10 秒ほど待つ）。カードにならなければ preview が null で、理由は区別しない。投稿できるルームだけ。1 人あたり 1 分に 30 回まで。",
		auth:        authChatUser,
		request:     body[previewLinkRequest](),
		status:      http.StatusOK, response: body[previewLinkResponse](),
		errors: []int{http.StatusBadRequest, http.StatusForbidden, http.StatusNotFound, http.StatusConflict, http.StatusUnprocessableEntity, http.StatusTooManyRequests},
	},
	{
		pattern:     "GET /api/v1/rooms/{roomID}/messages/{messageID}/link-previews/{previewID}/urls",
		tag:         "link-previews",
		summary:     "リンクのプレビューの画像とアイコンの URL を取る",
		description: "自前のストレージに写した画像とアイコンの、署名付き GET URL（5 分）。ないものは null。",
		auth:        authChatUser,
		status:      http.StatusOK, response: body[linkPreviewURLsResponse](),
		errors: []int{http.StatusNotFound},
	},
	{
		pattern:     "DELETE /api/v1/rooms/{roomID}/messages/{messageID}/link-previews/{previewID}",
		tag:         "link-previews",
		summary:     "リンクのプレビューを消す",
		description: "投稿した本人だけ。確認はせず、消してあっても 204（冪等）。編集しても戻らない。ほかの人には message.updated で届く。",
		auth:        authChatUser,
		status:      http.StatusNoContent,
		errors:      []int{http.StatusForbidden, http.StatusNotFound, http.StatusConflict},
	},
	// huddles
	{
		pattern:     "POST /api/v1/rooms/{roomID}/huddle/ice-servers",
		tag:         "huddles",
		summary:     "ハドルに入るための ICE サーバーを取る",
		description: "STUN と TURN（Cloudflare）の一覧。RTCPeerConnection を作る前に取る。TURN の認証情報は 12 時間で切れるので、長いハドルでは取り直す。そのルームに投稿できる人だけ。1 人あたり 1 分に 30 回まで。Cloudflare の設定がなければ 503。",
		auth:        authChatUser,
		status:      http.StatusOK, response: body[huddleICEServersResponse](),
		errors: []int{http.StatusForbidden, http.StatusNotFound, http.StatusConflict, http.StatusTooManyRequests, http.StatusServiceUnavailable},
	},
	{
		pattern:     "POST /api/v1/rooms/{roomID}/huddle/participants",
		tag:         "huddles",
		summary:     "ハドルに入る",
		description: "ブラウザの offer でマイクの音声を送り始め、answer を返す。進行中のハドルがなければ始め、会話にハドルのメッセージを残す（DM では相手を呼び出す）。同じ人の前の参加（別の端末・別のハドル）は外れる。20 人まで。",
		auth:        authChatUser,
		request:     body[joinHuddleRequest](),
		status:      http.StatusCreated, response: body[joinHuddleResponse](),
		errors: []int{http.StatusForbidden, http.StatusNotFound, http.StatusConflict, http.StatusUnprocessableEntity, http.StatusServiceUnavailable},
	},
	{
		pattern:     "POST /api/v1/huddles/{huddleID}/participants/{participantID}/subscriptions",
		tag:         "huddles",
		summary:     "ほかの参加者の音声を受ける",
		description: "同じハドルにいる人の音声を受ける。自分といない人は黙って飛ばす。offer が返ったら、ブラウザの answer を renegotiate で返す。参加がもうなければ 409 huddle-participant-gone。",
		auth:        authChatUser,
		request:     body[subscribeHuddleRequest](),
		status:      http.StatusOK, response: body[subscribeHuddleResponse](),
		errors: []int{http.StatusConflict, http.StatusUnprocessableEntity, http.StatusServiceUnavailable},
	},
	{
		pattern:     "POST /api/v1/huddles/{huddleID}/participants/{participantID}/subscriptions/close",
		tag:         "huddles",
		summary:     "受けている音声を閉じる",
		description: "抜けた人の分の受けるトラックを閉じる。",
		auth:        authChatUser,
		request:     body[unsubscribeHuddleRequest](),
		status:      http.StatusNoContent,
		errors:      []int{http.StatusConflict, http.StatusUnprocessableEntity, http.StatusServiceUnavailable},
	},
	{
		pattern:     "PUT /api/v1/huddles/{huddleID}/participants/{participantID}/renegotiate",
		tag:         "huddles",
		summary:     "受ける音声の offer に答える",
		description: "subscriptions の offer に対するブラウザの answer を渡す。同じ端末の SDP のやり取りは 1 本の列に並べる（重なると 409 huddle-negotiation-conflict）。",
		auth:        authChatUser,
		request:     body[renegotiateHuddleRequest](),
		status:      http.StatusNoContent,
		errors:      []int{http.StatusConflict, http.StatusUnprocessableEntity, http.StatusServiceUnavailable},
	},
	{
		pattern:     "PATCH /api/v1/huddles/{huddleID}/participants/{participantID}",
		tag:         "huddles",
		summary:     "ミュートの印を変える",
		description: "ほかの人の画面にミュートの印を出すため。音を止めるのはブラウザで、サーバーは強制しない。",
		auth:        authChatUser,
		request:     body[updateHuddleParticipantRequest](),
		status:      http.StatusNoContent,
		errors:      []int{http.StatusConflict, http.StatusServiceUnavailable},
	},
	{
		pattern:     "DELETE /api/v1/huddles/{huddleID}/participants/{participantID}",
		tag:         "huddles",
		summary:     "ハドルから抜ける",
		description: "もう外れていても 204。最後の人が抜けるとハドルが終わる。",
		auth:        authChatUser,
		status:      http.StatusNoContent,
		errors:      []int{http.StatusServiceUnavailable},
	},
	{
		pattern:     "POST /api/v1/huddles/{huddleID}/joining-soon",
		tag:         "huddles",
		summary:     "「もうすぐ参加する」を知らせる",
		description: "DM の呼び出しの「もうすぐ参加する」。ハドルにいる人の画面に 5 分出る（huddle.updated の joining_soon）。",
		auth:        authChatUser,
		status:      http.StatusNoContent,
		errors:      []int{http.StatusForbidden, http.StatusNotFound, http.StatusConflict, http.StatusServiceUnavailable},
	},
	{
		pattern:     "POST /api/v1/attachments/{attachmentID}/complete",
		tag:         "attachments",
		summary:     "アップロードした添付ファイルを確かめる",
		description: "PUT が済んだことを HEAD で確かめる。置かれていない・申告と違うときは 409。冪等。",
		auth:        authChatUser,
		status:      http.StatusOK, response: body[attachmentResponse](),
		errors: []int{http.StatusNotFound, http.StatusConflict},
	},
	{
		pattern: "GET /api/v1/attachments/{attachmentID}/url",
		tag:     "attachments",
		summary: "添付ファイルの署名付き GET URL を取る",
		auth:    authChatUser,
		status:  http.StatusOK, response: body[signedURLResponse](),
		errors: []int{http.StatusNotFound},
	},

	// websocket
	{
		pattern:     "POST /api/v1/ws/ticket",
		tag:         "websocket",
		summary:     "WebSocket の接続に使う ws-ticket を発行する",
		description: "短命で 1 回だけ使える。",
		auth:        authChatUser,
		status:      http.StatusOK, response: body[wsTicketResponse](),
	},
	{
		pattern:     "GET /api/v1/ws",
		tag:         "websocket",
		summary:     "WebSocket に接続する",
		description: "Access Token ではなく ws-ticket で認証する（ブラウザの WebSocket はヘッダを付けられないため）。成功すると 101 でアップグレードし、以降のフレームは docs/events.md に従う。",
		auth:        authNone,
		query: []apiParam{
			{name: "ticket", typ: "string", required: true, description: "POST /api/v1/ws/ticket で発行した ws-ticket"},
		},
		status: http.StatusSwitchingProtocols, response: nil,
		errors: []int{http.StatusUnauthorized},
	},

	// system
	{
		pattern:     "GET /healthz",
		tag:         "system",
		summary:     "ヘルスチェック",
		description: "すべての依存先（DB・Redis など）に到達できれば 200、1 つでも失敗すれば 503（本文は同じ形）。",
		auth:        authNone,
		status:      http.StatusOK, response: body[healthResponse](),
		errors: []int{http.StatusServiceUnavailable},
	},
	{
		pattern:     "GET /.well-known/jwks.json",
		tag:         "system",
		summary:     "Access Token の検証用の公開鍵（JWK Set）",
		description: "本文は JWK Set（RFC 7517）で、Go の型ではなく鍵のバイト列をそのまま書く。5 分キャッシュさせる。",
		auth:        authNone,
		status:      http.StatusOK, rawMedia: "application/jwk-set+json",
	},
}
