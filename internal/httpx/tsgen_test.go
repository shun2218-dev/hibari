package httpx

import (
	"bytes"
	"encoding/json/v2"
	"flag"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/shun2218-dev/hibari/internal/chat"
	"github.com/shun2218-dev/hibari/internal/chat/authz"
)

// Web クライアントの TypeScript の型を、このパッケージの JSON の型から生成する（ロードマップ Phase 6-2）。
//
// 生成をテストにしているのは、レスポンスの型を非公開のまま reflect で読めるうえ、
// 「生成し直すのを忘れた」変更が `go test`（CI）で落ちるため。sqlc の diff と同じ役割。
//
//	go test ./internal/httpx -run TestTypeScriptTypes -update   # make ts-types
//
// 変換の規則
//   - struct は interface に、ここに登録した名前で出す。登録していない struct を参照したら失敗する。
//   - 埋め込んだ struct のフィールドは展開する（encoding/json と同じ）。
//   - ポインタは null になりうる（`T | null`）。omitempty / omitzero は省略されうる（`field?:`）。
//     リクエストでは、ポインタも「省略してよい」の意味なので `field?: T | null` にする。
//   - スライスと map は `T[]` / `Record<string, T>`。encoding/json/v2 は nil を null にしない（TestTypeScriptResponsesHaveNoUnexpectedNull）。
//   - time.Time は RFC 3339 の文字列。数値は number（seq は 2^53 を超えない）。
//   - 名前付きの string 型は、登録した値の union にする。値の漏れは Go のソースの const と照らして検査する。
var updateTS = flag.Bool("update", false, "web/lib/api/types.gen.ts を書き直す")

const (
	tsOutPath  = "../../web/lib/api/types.gen.ts"
	modulePath = "github.com/shun2218-dev/hibari/"
)

type tsEnum struct {
	name   string
	typ    reflect.Type
	values []string
}

func enumOf[T ~string](name string, values ...T) tsEnum {
	vs := make([]string, len(values))
	for i, v := range values {
		vs[i] = string(v)
	}
	return tsEnum{name: name, typ: reflect.TypeFor[T](), values: vs}
}

var tsEnums = []tsEnum{
	enumOf("Role", authz.RoleOwner, authz.RoleAdmin, authz.RoleMember),
	enumOf("InvitePolicy", authz.InvitePolicyAdminsOnly, authz.InvitePolicyAllMembers),
	enumOf("RoomKind", authz.RoomPublic, authz.RoomPrivate, authz.RoomDM),
	enumOf("InviteStatus", chat.InviteActive, chat.InviteExhausted, chat.InviteExpired, chat.InviteRevoked),
	enumOf("AttachmentStatus", chat.AttachmentPending, chat.AttachmentUploaded, chat.AttachmentAttached, chat.AttachmentDeleted),
	enumOf("RemovalReason", chat.RemovalLeft, chat.RemovalRemoved),
	enumOf("MessageKind", chat.MessageKindUser, chat.MessageKindSystem),
	enumOf("SystemEventType",
		chat.SystemRoomCreated, chat.SystemMemberJoined, chat.SystemMemberLeft, chat.SystemMemberRemoved, chat.SystemRoomRenamed),
	enumOf("ProblemType",
		problemBadRequest, problemValidationError, problemUnauthenticated, problemForbidden, problemNotFound, problemInternal,
		problemRateLimited, problemInvalidCredentials, problemInvalidRefreshToken, problemInvalidOneTimeToken,
		problemHandleTaken, problemEmailTaken, problemAvatarNotUploaded, problemAvatarMismatch,
		problemInviteInvalid, problemInviteExpired, problemInviteExhausted, problemOwnerMustTransfer,
		problemRoomNameTaken, problemUserNotInWorkspace, problemMessageDeleted,
		problemAttachmentNotUploaded, problemAttachmentMismatch, problemWSTicketInvalid),
	enumOf("ClientMessageType", clientSubscribe, clientUnsubscribe, clientTyping, clientPing),
	enumOf("AckError", ackInvalidMessage, ackNotFound, ackNotSubscribed, ackForbidden, ackTooManySubscriptions, ackInternal),
}

type tsDecl struct {
	name    string
	typ     reflect.Type
	request bool
}

func response[T any](name string) tsDecl { return tsDecl{name: name, typ: reflect.TypeFor[T]()} }
func request[T any](name string) tsDecl {
	return tsDecl{name: name, typ: reflect.TypeFor[T](), request: true}
}

// tsDecls は出力する型。出力の順序もこの順。
var tsDecls = []tsDecl{
	response[problem]("Problem"),
	response[problemFieldError]("ProblemFieldError"),
	response[healthResponse]("Health"),

	// 認証（ADR 0010 / 0019 / 0020）
	request[registerRequest]("RegisterRequest"),
	request[loginRequest]("LoginRequest"),
	request[refreshTokenRequest]("RefreshTokenRequest"),
	request[oneTimeTokenRequest]("OneTimeTokenRequest"),
	request[passwordResetRequest]("PasswordResetRequest"),
	request[passwordResetConfirmRequest]("PasswordResetConfirmRequest"),
	response[tokenResponse]("TokenResponse"),
	response[userResponse]("User"),
	request[updateProfileRequest]("UpdateProfileRequest"),
	response[sessionResponse]("Session"),
	response[sessionListResponse]("SessionList"),
	response[revokeSessionsResponse]("RevokeSessionsResponse"),
	request[avatarUploadRequest]("AvatarUploadRequest"),
	response[avatarUploadResponse]("AvatarUpload"),
	request[completeAvatarUploadRequest]("CompleteAvatarUploadRequest"),
	request[avatarURLsRequest]("AvatarURLsRequest"),
	response[avatarURLsResponse]("AvatarURLs"),
	response[uploadResponse]("Upload"),
	response[signedURLResponse]("SignedURL"),

	// ワークスペース・メンバー・招待（ADR 0011）
	response[userProfileResponse]("UserProfile"),
	request[createWorkspaceRequest]("CreateWorkspaceRequest"),
	request[updateWorkspaceRequest]("UpdateWorkspaceRequest"),
	response[workspaceResponse]("Workspace"),
	response[workspaceListResponse]("WorkspaceList"),
	response[memberResponse]("Member"),
	response[memberListResponse]("MemberList"),
	request[changeMemberRoleRequest]("ChangeMemberRoleRequest"),
	request[transferOwnershipRequest]("TransferOwnershipRequest"),
	request[createInviteRequest]("CreateInviteRequest"),
	response[inviteResponse]("Invite"),
	response[inviteListResponse]("InviteList"),
	response[invitePreviewResponse]("InvitePreview"),
	response[invitePreviewWorkspaceResponse]("InvitePreviewWorkspace"),
	response[inviteAcceptanceResponse]("InviteAcceptance"),

	// ルーム
	request[createRoomRequest]("CreateRoomRequest"),
	request[updateRoomRequest]("UpdateRoomRequest"),
	response[roomResponse]("Room"),
	response[roomListResponse]("RoomList"),
	response[dmPeerResponse]("DMPeer"),
	response[lastMessageResponse]("LastMessage"),
	request[addRoomMemberRequest]("AddRoomMemberRequest"),
	response[roomMemberResponse]("RoomMember"),
	response[roomMemberListResponse]("RoomMemberList"),

	// メッセージと添付（ADR 0012 / 0013 / 0014）
	request[sendMessageRequest]("SendMessageRequest"),
	request[editMessageRequest]("EditMessageRequest"),
	response[messageResponse]("Message"),
	response[systemEventResponse]("SystemEvent"),
	response[threadSummaryResponse]("ThreadSummary"),
	response[messageAttachmentResponse]("MessageAttachment"),
	response[messageListResponse]("MessageList"),
	request[markRoomReadRequest]("MarkRoomReadRequest"),
	response[readStateResponse]("ReadState"),
	// スレッド（ADR 0036）
	response[threadMessageListResponse]("ThreadMessageList"),
	response[threadReadStateResponse]("ThreadReadState"),
	response[threadRoomResponse]("ThreadRoom"),
	response[followedThreadResponse]("FollowedThread"),
	response[threadListResponse]("ThreadList"),
	request[createAttachmentRequest]("CreateAttachmentRequest"),
	response[createAttachmentResponse]("CreateAttachmentResponse"),
	response[attachmentResponse]("Attachment"),

	// WebSocket（docs/events.md）
	response[wsTicketResponse]("WSTicket"),
	request[clientMessage]("ClientMessage"),
	response[ackMessage]("Ack"),
	response[memberJoinedData]("MemberJoinedData"),
	response[memberLeftData]("MemberLeftData"),
	response[roomUpdatedData]("RoomUpdatedData"),
	response[roomMemberRemovedData]("RoomMemberRemovedData"),
	response[roomReadData]("RoomReadData"),
	response[workspaceUpdatedData]("WorkspaceUpdatedData"),
	response[workspaceMemberRemovedData]("WorkspaceMemberRemovedData"),
	response[workspaceRoleChangedData]("WorkspaceRoleChangedData"),
	response[presenceChangedData]("PresenceChangedData"),
	response[typingStartedData]("TypingStartedData"),
}

// tsSkipped は JSON のタグを持つが、クライアントの型にしない struct。
var tsSkipped = []reflect.Type{
	// Data が any なので、下の tsEvents から ServerEvent の union として出す。
	reflect.TypeFor[serverEvent](),
}

// tsFieldTypes は、Go の型からは決まらないフィールドの TypeScript の型。キーは「Go の型名.JSON の名前」。
var tsFieldTypes = map[string]string{
	// 値の検証はドメインが行うので Go では string で受けるが、送ってよい値は決まっている。
	"createRoomRequest.kind":               "RoomKind",
	"changeMemberRoleRequest.role":         "Role",
	"updateWorkspaceRequest.invite_policy": "InvitePolicy",
	// 実際の値は PROBLEM_TYPE_PREFIX が付いた URI。ProblemType は接頭辞を除いた部分。
	"problem.type":    "string",
	"ackMessage.type": strconv.Quote(ackType),
}

// tsEvents はサーバーからのイベント。data の型は eventData に chat のデータを渡して決める（実装と食い違わないように）。
var tsEvents = []struct {
	typ  chat.EventType
	data any
}{
	{chat.EventMessageCreated, chat.Message{}},
	{chat.EventMessageUpdated, chat.Message{}},
	{chat.EventMessageDeleted, chat.Message{}},
	{chat.EventMemberJoined, chat.MemberJoined{}},
	{chat.EventMemberLeft, chat.MemberLeft{}},
	{chat.EventRoomUpdated, chat.RoomUpdated{}},
	{chat.EventRoomMemberRemoved, chat.RoomMemberRemoved{}},
	{chat.EventRoomRead, chat.RoomRead{}},
	{chat.EventWorkspaceUpdated, chat.WorkspaceUpdated{}},
	{chat.EventWorkspaceMemberRemoved, chat.WorkspaceMemberRemoved{}},
	{chat.EventWorkspaceRoleChanged, chat.WorkspaceRoleChanged{}},
	{chat.EventPresenceChanged, chat.PresenceChanged{}},
	{chat.EventTypingStarted, chat.TypingStarted{}},
}

func TestTypeScriptTypes(t *testing.T) {
	got, err := generateTypeScript()
	if err != nil {
		t.Fatal(err)
	}
	if *updateTS {
		if err := os.WriteFile(tsOutPath, got, 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	want, err := os.ReadFile(tsOutPath)
	if err != nil {
		t.Fatalf("read %s: %v（`make ts-types` で生成する）", tsOutPath, err)
	}
	if !bytes.Equal(got, want) {
		t.Fatalf("%s is out of date: run `make ts-types`", tsOutPath)
	}
}

// 登録した enum の値が、Go のソースにある同じ型の const と一致すること。定数を足して登録を忘れたら落ちる。
func TestTypeScriptEnumsMatchGoConstants(t *testing.T) {
	for _, e := range tsEnums {
		t.Run(e.name, func(t *testing.T) {
			consts, err := stringConstsOf(e.typ)
			if err != nil {
				t.Fatal(err)
			}
			got, want := slices.Sorted(slices.Values(e.values)), slices.Sorted(slices.Values(consts))
			if !slices.Equal(got, want) {
				t.Errorf("values = %v, Go constants of %s = %v", got, e.typ, want)
			}
		})
	}
}

// chat.EventType の const がすべて tsEvents にあること。
func TestTypeScriptEventsCoverAllEventTypes(t *testing.T) {
	consts, err := stringConstsOf(reflect.TypeFor[chat.EventType]())
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, ev := range tsEvents {
		got = append(got, string(ev.typ))
	}
	if !slices.Equal(slices.Sorted(slices.Values(got)), slices.Sorted(slices.Values(consts))) {
		t.Errorf("tsEvents = %v, chat.EventType constants = %v", got, consts)
	}
}

// このパッケージの JSON のタグを持つ struct が、すべて登録されているか意図して外されていること。
// レスポンスの型を足して登録を忘れると、クライアントの型が黙って欠ける。
func TestTypeScriptDeclsCoverJSONStructs(t *testing.T) {
	known := map[string]bool{}
	for _, d := range tsDecls {
		known[d.typ.Name()] = true
	}
	for _, typ := range tsSkipped {
		known[typ.Name()] = true
	}
	fset := token.NewFileSet()
	files, err := parsePackageDir(fset, ".")
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range files {
		ast.Inspect(f, func(n ast.Node) bool {
			spec, ok := n.(*ast.TypeSpec)
			if !ok {
				return true
			}
			st, ok := spec.Type.(*ast.StructType)
			if !ok || !hasJSONTag(st) {
				return true
			}
			if !known[spec.Name.Name] {
				t.Errorf("%s: %s has json tags but is not in tsDecls or tsSkipped", fset.Position(spec.Pos()), spec.Name.Name)
			}
			return true
		})
	}
}

func hasJSONTag(st *ast.StructType) bool {
	for _, f := range st.Fields.List {
		if f.Tag != nil && strings.Contains(f.Tag.Value, `json:"`) {
			return true
		}
	}
	return false
}

func generateTypeScript() ([]byte, error) {
	g := &tsGen{names: map[reflect.Type]string{}}
	for _, e := range tsEnums {
		g.names[e.typ] = e.name
	}
	for _, d := range tsDecls {
		if _, dup := g.names[d.typ]; dup {
			return nil, fmt.Errorf("%s is registered twice", d.typ)
		}
		g.names[d.typ] = d.name
	}
	docs, err := fieldDocs()
	if err != nil {
		return nil, err
	}
	g.docs = docs

	b := &g.buf
	b.WriteString("// Code generated by internal/httpx/tsgen_test.go. DO NOT EDIT.\n")
	b.WriteString("// Go の型を変えたら `make ts-types` で生成し直す（ロードマップ Phase 6-2）。\n\n")

	fmt.Fprintf(b, "/** Problem の type に付く接頭辞。ProblemType はこれを除いた部分。 */\nexport const PROBLEM_TYPE_PREFIX = %s;\n\n", strconv.Quote(problemTypePrefix))

	for _, e := range tsEnums {
		quoted := make([]string, len(e.values))
		for i, v := range e.values {
			quoted[i] = strconv.Quote(v)
		}
		fmt.Fprintf(b, "export type %s = %s;\n\n", e.name, strings.Join(quoted, " | "))
	}

	for _, d := range tsDecls {
		if err := g.writeInterface(d); err != nil {
			return nil, err
		}
	}

	b.WriteString("/** サーバーからのイベント（docs/events.md）。type で data の型が決まる。 */\nexport type ServerEvent =")
	for _, ev := range tsEvents {
		data, err := eventData(ev.data)
		if err != nil {
			return nil, err
		}
		name, ok := g.names[reflect.TypeOf(data)]
		if !ok {
			return nil, fmt.Errorf("event %s: data type %T is not registered", ev.typ, data)
		}
		fmt.Fprintf(b, "\n  | { type: %s; data: %s }", strconv.Quote(string(ev.typ)), name)
	}
	b.WriteString(";\n\n")
	b.WriteString("export type ServerEventType = ServerEvent[\"type\"];\n\n")
	b.WriteString("/** サーバーから届く WebSocket のフレーム。イベントか ack のどちらか。 */\nexport type ServerMessage = ServerEvent | Ack;\n")

	if g.err != nil {
		return nil, g.err
	}
	return b.Bytes(), nil
}

type tsGen struct {
	buf   bytes.Buffer
	names map[reflect.Type]string
	// docs は「Go の型名.Go のフィールド名」から、フィールドのコメント。
	docs map[string]string
	err  error
}

type tsField struct {
	goType   string
	goName   string
	jsonName string
	typ      reflect.Type
	optional bool
	nullable bool
}

func (g *tsGen) writeInterface(d tsDecl) error {
	if d.typ.Kind() != reflect.Struct {
		return fmt.Errorf("%s: not a struct", d.typ)
	}
	fields, err := jsonFields(d.typ, d.request)
	if err != nil {
		return err
	}
	b := &g.buf
	fmt.Fprintf(b, "export interface %s {\n", d.name)
	for _, f := range fields {
		if doc := g.docs[f.goType+"."+f.goName]; doc != "" {
			// Go のコメントは「RequestID は…」とフィールド名で始まるので、JSON の名前に読み替える。
			if rest, ok := strings.CutPrefix(doc, f.goName+" "); ok {
				doc = f.jsonName + " " + rest
			}
			fmt.Fprintf(b, "  /** %s */\n", doc)
		}
		ts, ok := tsFieldTypes[d.typ.Name()+"."+f.jsonName]
		if !ok {
			ts, err = g.tsType(f.typ)
			if err != nil {
				return fmt.Errorf("%s.%s: %w", d.typ.Name(), f.goName, err)
			}
		}
		if f.nullable {
			ts += " | null"
		}
		opt := ""
		if f.optional {
			opt = "?"
		}
		fmt.Fprintf(b, "  %s%s: %s;\n", f.jsonName, opt, ts)
	}
	b.WriteString("}\n\n")
	return nil
}

// jsonFields は encoding/json が出すフィールドを、埋め込みを展開して宣言の順に返す。
func jsonFields(t reflect.Type, request bool) ([]tsField, error) {
	var out []tsField
	for i := range t.NumField() {
		sf := t.Field(i)
		tag := sf.Tag.Get("json")
		if tag == "-" {
			continue
		}
		name, opts, _ := strings.Cut(tag, ",")
		if sf.Anonymous && name == "" {
			inner, err := jsonFields(sf.Type, request)
			if err != nil {
				return nil, err
			}
			out = append(out, inner...)
			continue
		}
		if !sf.IsExported() {
			continue
		}
		if name == "" {
			return nil, fmt.Errorf("%s.%s: missing json tag", t.Name(), sf.Name)
		}
		f := tsField{goType: t.Name(), goName: sf.Name, jsonName: name, typ: sf.Type}
		tagOpts := strings.Split(opts, ",")
		omitempty := slices.Contains(tagOpts, "omitempty") || slices.Contains(tagOpts, "omitzero")
		if f.typ.Kind() == reflect.Pointer {
			f.typ = f.typ.Elem()
			switch {
			case request:
				// リクエストのポインタは「省略してよい（null も省略と同じ）」。
				f.optional, f.nullable = true, true
			case omitempty:
				// nil なら出力されない。null は出ない。
				f.optional = true
			default:
				f.nullable = true
			}
		} else if omitempty {
			f.optional = true
		}
		out = append(out, f)
	}
	return out, nil
}

var timeType = reflect.TypeFor[time.Time]()

func (g *tsGen) tsType(t reflect.Type) (string, error) {
	if t == timeType {
		return "string", nil
	}
	if name, ok := g.names[t]; ok {
		return name, nil
	}
	switch t.Kind() {
	case reflect.String:
		if t.Name() != "string" {
			return "", fmt.Errorf("named string type %s is not registered in tsEnums", t)
		}
		return "string", nil
	case reflect.Bool:
		return "boolean", nil
	case reflect.Int, reflect.Int32, reflect.Int64, reflect.Uint, reflect.Uint32, reflect.Uint64, reflect.Float64:
		return "number", nil
	case reflect.Slice:
		elem, err := g.tsType(t.Elem())
		if err != nil {
			return "", err
		}
		return elem + "[]", nil
	case reflect.Map:
		if t.Key().Kind() != reflect.String {
			return "", fmt.Errorf("map key must be string: %s", t)
		}
		elem, err := g.tsType(t.Elem())
		if err != nil {
			return "", err
		}
		return "Record<string, " + elem + ">", nil
	case reflect.Struct:
		return "", fmt.Errorf("struct %s is not registered in tsDecls", t)
	default:
		return "", fmt.Errorf("unsupported type %s", t)
	}
}

// fieldDocs は、このパッケージの struct のフィールドのコメントを集める。TypeScript の JSDoc にそのまま出す。
func fieldDocs() (map[string]string, error) {
	fset := token.NewFileSet()
	files, err := parsePackageDir(fset, ".")
	if err != nil {
		return nil, err
	}
	docs := map[string]string{}
	for _, f := range files {
		ast.Inspect(f, func(n ast.Node) bool {
			spec, ok := n.(*ast.TypeSpec)
			if !ok {
				return true
			}
			st, ok := spec.Type.(*ast.StructType)
			if !ok {
				return true
			}
			for _, field := range st.Fields.List {
				if field.Doc == nil {
					continue
				}
				text := strings.Join(strings.Fields(field.Doc.Text()), " ")
				for _, n := range field.Names {
					docs[spec.Name.Name+"."+n.Name] = text
				}
			}
			return true
		})
	}
	return docs, nil
}

// stringConstsOf は、型を宣言したパッケージのソースから、その型の const の値を集める。
func stringConstsOf(t reflect.Type) ([]string, error) {
	rel, ok := strings.CutPrefix(t.PkgPath(), modulePath)
	if !ok {
		return nil, fmt.Errorf("%s is outside the module", t)
	}
	fset := token.NewFileSet()
	files, err := parsePackageDir(fset, filepath.Join("..", "..", rel))
	if err != nil {
		return nil, err
	}
	var values []string
	for _, f := range files {
		for _, decl := range f.Decls {
			gd, ok := decl.(*ast.GenDecl)
			if !ok || gd.Tok != token.CONST {
				continue
			}
			for _, s := range gd.Specs {
				vs := s.(*ast.ValueSpec)
				ident, ok := vs.Type.(*ast.Ident)
				if !ok || ident.Name != t.Name() {
					continue
				}
				for _, v := range vs.Values {
					lit, ok := v.(*ast.BasicLit)
					if !ok || lit.Kind != token.STRING {
						return nil, fmt.Errorf("%s: const of %s must be a string literal", fset.Position(v.Pos()), t)
					}
					s, err := strconv.Unquote(lit.Value)
					if err != nil {
						return nil, err
					}
					values = append(values, s)
				}
			}
		}
	}
	return values, nil
}

// parsePackageDir はディレクトリのテスト以外の Go のファイルを読む。
func parsePackageDir(fset *token.FileSet, dir string) ([]*ast.File, error) {
	paths, err := filepath.Glob(filepath.Join(dir, "*.go"))
	if err != nil {
		return nil, err
	}
	var files []*ast.File
	for _, p := range paths {
		if strings.HasSuffix(p, "_test.go") {
			continue
		}
		f, err := parser.ParseFile(fset, p, nil, parser.ParseComments)
		if err != nil {
			return nil, err
		}
		files = append(files, f)
	}
	return files, nil
}

// 登録したレスポンスの型をゼロ値のまま marshalJSON で書き出し、生成した型が null を許さないフィールドに null が出ないこと。
// nil のスライスや map はゼロ値そのものなので、ハンドラが make し忘れた場合と同じ JSON になる（ADR 0022）。
func TestTypeScriptResponsesHaveNoUnexpectedNull(t *testing.T) {
	for _, d := range tsDecls {
		if d.request {
			continue
		}
		t.Run(d.name, func(t *testing.T) {
			b, err := marshalJSON(reflect.New(d.typ).Elem().Interface())
			if err != nil {
				t.Fatal(err)
			}
			var v any
			if err := unmarshalJSONForTest(b, &v); err != nil {
				t.Fatal(err)
			}
			checkNoUnexpectedNull(t, d.name, d.typ, v)
		})
	}
}

func checkNoUnexpectedNull(t *testing.T, path string, typ reflect.Type, v any) {
	t.Helper()
	obj, ok := v.(map[string]any)
	if !ok {
		t.Errorf("%s: want a JSON object, got %T", path, v)
		return
	}
	fields, err := jsonFields(typ, false)
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range fields {
		p := path + "." + f.jsonName
		val, present := obj[f.jsonName]
		switch {
		case !present:
			if !f.optional {
				t.Errorf("%s: missing, but the TypeScript type requires it", p)
			}
		case val == nil:
			if !f.nullable {
				t.Errorf("%s: null, but the TypeScript type does not allow null", p)
			}
		case f.typ.Kind() == reflect.Struct && f.typ != timeType:
			checkNoUnexpectedNull(t, p, f.typ, val)
		}
	}
}

func unmarshalJSONForTest(b []byte, v any) error { return json.Unmarshal(b, v) }
