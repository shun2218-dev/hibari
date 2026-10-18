package httpx

import (
	"bytes"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"fmt"
	"go/ast"
	"go/token"
	"maps"
	"net/http"
	"os"
	"reflect"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"testing"
	"unicode"
)

// REST の API リファレンス（docs/api/openapi.json）を、このパッケージの Go の型とエンドポイントの表から生成する（ADR 0064 決定 5）。
//
// 型の表（tsDecls / tsEnums / tsFieldTypes）と変換の規則は TypeScript の生成（tsgen_test.go）と同じものを使うので、
// TypeScript と OpenAPI で型がずれることはない。パスは openapi_routes_test.go の apiRoutes から作る。
// 生成し直すのを忘れると `go test`（CI）で落ちる。
//
//	go test ./internal/httpx -run '^TestOpenAPI$' -update   # make openapi
const openAPIOutPath = "../../docs/api/openapi.json"

func TestOpenAPI(t *testing.T) {
	got, err := generateOpenAPI()
	if err != nil {
		t.Fatal(err)
	}
	if *updateTS {
		if err := os.WriteFile(openAPIOutPath, got, 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	want, err := os.ReadFile(openAPIOutPath)
	if err != nil {
		t.Fatalf("read %s: %v（`make openapi` で生成する）", openAPIOutPath, err)
	}
	if !bytes.Equal(got, want) {
		t.Fatalf("%s is out of date: run `make openapi`", openAPIOutPath)
	}
}

// ServeMux に登録しているパターンと apiRoutes が 1 対 1 であること。エンドポイントを足して表に書き忘れたら落ちる。
func TestOpenAPIRoutesMatchSource(t *testing.T) {
	registered, err := registeredRoutes()
	if err != nil {
		t.Fatal(err)
	}
	var inTable []string
	seen := map[string]bool{}
	for _, r := range apiRoutes {
		if seen[r.pattern] {
			t.Errorf("%s is in apiRoutes twice", r.pattern)
		}
		seen[r.pattern] = true
		inTable = append(inTable, r.pattern)
	}
	for pattern := range registered {
		if !seen[pattern] {
			t.Errorf("%s is registered but not in apiRoutes", pattern)
		}
	}
	for _, pattern := range inTable {
		if _, ok := registered[pattern]; !ok {
			t.Errorf("%s is in apiRoutes but not registered", pattern)
		}
	}
}

// 表の中身の決まりごと。
func TestOpenAPIRoutesAreWellFormed(t *testing.T) {
	tags := map[string]bool{}
	for _, tag := range apiTags {
		tags[tag.name] = true
	}
	for _, r := range apiRoutes {
		if !tags[r.tag] {
			t.Errorf("%s: unknown tag %q", r.pattern, r.tag)
		}
		if r.summary == "" {
			t.Errorf("%s: summary is empty", r.pattern)
		}
		if r.status == 0 {
			t.Errorf("%s: status is not set", r.pattern)
		}
		if slices.Contains(r.errors, r.status) {
			t.Errorf("%s: status %d is also listed in errors", r.pattern, r.status)
		}
		if r.request != nil && (slices.Contains(r.errors, http.StatusUnsupportedMediaType) || slices.Contains(r.errors, http.StatusRequestEntityTooLarge)) {
			t.Errorf("%s: 415 / 413 are added from request; do not list them in errors", r.pattern)
		}
		if r.response != nil && r.rawMedia != "" {
			t.Errorf("%s: set either response or rawMedia", r.pattern)
		}
		if r.auth != authNone && slices.Contains(r.errors, http.StatusUnauthorized) {
			t.Errorf("%s: 401 is added from auth; do not list it in errors", r.pattern)
		}
	}
}

var routePatternRe = regexp.MustCompile(`^(GET|POST|PUT|PATCH|DELETE) /`)

// registeredRoutes は、このパッケージのソースから、ServeMux に渡しているパターンと、そのハンドラの名前を集める。
// mux.Handle / mux.HandleFunc と chat.go の handle(...) のどれで登録していても、第 1 引数のパターンの文字列で拾う。
// ハンドラの名前は operationId にする（`h.createWorkspace` → createWorkspace）。
func registeredRoutes() (map[string]string, error) {
	fset := token.NewFileSet()
	files, err := parsePackageDir(fset, ".")
	if err != nil {
		return nil, err
	}
	routes := map[string]string{}
	var errs []error
	for _, f := range files {
		ast.Inspect(f, func(n ast.Node) bool {
			call, ok := n.(*ast.CallExpr)
			if !ok || len(call.Args) < 2 {
				return true
			}
			lit, ok := call.Args[0].(*ast.BasicLit)
			if !ok || lit.Kind != token.STRING {
				return true
			}
			pattern, err := strconv.Unquote(lit.Value)
			if err != nil || !routePatternRe.MatchString(pattern) {
				return true
			}
			name := handlerName(call.Args[1])
			if name == "" {
				errs = append(errs, fmt.Errorf("%s: cannot find the handler of %s", fset.Position(call.Pos()), pattern))
				return true
			}
			if _, dup := routes[pattern]; dup {
				errs = append(errs, fmt.Errorf("%s: %s is registered twice", fset.Position(call.Pos()), pattern))
			}
			routes[pattern] = name
			return true
		})
	}
	if len(errs) > 0 {
		return nil, errs[0]
	}
	return routes, nil
}

// handlerName は、登録の第 2 引数（requireAuth(http.HandlerFunc(h.me)) など）から、ハンドラの名前を取り出す。
func handlerName(expr ast.Expr) string {
	var name string
	ast.Inspect(expr, func(n ast.Node) bool {
		if name != "" {
			return false
		}
		switch n := n.(type) {
		case *ast.SelectorExpr:
			// h.createWorkspace
			if x, ok := n.X.(*ast.Ident); ok && x.Name == "h" {
				name = n.Sel.Name
				return false
			}
		case *ast.CallExpr:
			// Healthz(d.Logger, ...)
			if fn, ok := n.Fun.(*ast.Ident); ok && fn.IsExported() {
				r := []rune(fn.Name)
				r[0] = unicode.ToLower(r[0])
				name = string(r)
				return false
			}
		}
		return true
	})
	return name
}

// ---- 出力 ----

// jsonObject はキーの順を保つ JSON のオブジェクト。OpenAPI は人も読むので、プロパティを Go の宣言の順に出す。
type jsonObject []jsonMember

type jsonMember struct {
	key   string
	value any
}

func (o jsonObject) MarshalJSON() ([]byte, error) {
	var b bytes.Buffer
	b.WriteByte('{')
	for i, m := range o {
		if i > 0 {
			b.WriteByte(',')
		}
		k, err := json.Marshal(m.key)
		if err != nil {
			return nil, err
		}
		v, err := json.Marshal(m.value, json.Deterministic(true))
		if err != nil {
			return nil, fmt.Errorf("%s: %w", m.key, err)
		}
		b.Write(k)
		b.WriteByte(':')
		b.Write(v)
	}
	b.WriteByte('}')
	return b.Bytes(), nil
}

func (o *jsonObject) add(key string, value any) { *o = append(*o, jsonMember{key, value}) }

type openAPIGen struct {
	names map[reflect.Type]string
	enums map[string]tsEnum
	docs  map[string]string
	// used は paths から参照したスキーマの名前。components には参照したものだけを出す（WebSocket だけの型を出さない）。
	used  map[string]reflect.Type
	queue []reflect.Type
}

func generateOpenAPI() ([]byte, error) {
	g := &openAPIGen{names: map[reflect.Type]string{}, enums: map[string]tsEnum{}, used: map[string]reflect.Type{}}
	for _, e := range tsEnums {
		g.names[e.typ] = e.name
		g.enums[e.name] = e
	}
	for _, d := range tsDecls {
		g.names[d.typ] = d.name
	}
	docs, err := fieldDocs()
	if err != nil {
		return nil, err
	}
	g.docs = docs
	handlers, err := registeredRoutes()
	if err != nil {
		return nil, err
	}

	paths, err := g.paths(handlers)
	if err != nil {
		return nil, err
	}
	schemas, err := g.schemas()
	if err != nil {
		return nil, err
	}

	var tags []jsonObject
	for _, t := range apiTags {
		tags = append(tags, jsonObject{{"name", t.name}, {"description", t.description}})
	}
	doc := jsonObject{
		{"openapi", "3.1.0"},
		{"info", jsonObject{
			{"title", "hibari API"},
			{"version", "v1"},
			{"description", "hibari の REST API。docs/api/openapi.json は internal/httpx/openapi_test.go が生成する（ADR 0064）。" +
				"エラーは RFC 9457 の application/problem+json で返す。WebSocket のイベントは docs/events.md を見る。"},
		}},
		{"servers", []jsonObject{{{"url", "https://api.hibari-chat.com"}}}},
		{"tags", tags},
		{"paths", paths},
		{"components", jsonObject{
			{"securitySchemes", jsonObject{
				{"bearerAuth", jsonObject{
					{"type", "http"},
					{"scheme", "bearer"},
					{"bearerFormat", "JWT"},
					{"description", "Access Token。Web クライアントの refresh は Cookie で行う（ADR 0010 / 0024）。"},
				}},
			}},
			{"schemas", schemas},
		}},
	}
	b, err := json.Marshal(doc)
	if err != nil {
		return nil, err
	}
	v := jsontext.Value(b)
	if err := v.Indent(jsontext.WithIndent("  ")); err != nil {
		return nil, err
	}
	return append(v, '\n'), nil
}

var pathParamRe = regexp.MustCompile(`\{([A-Za-z]+)\}`)

// pathParamDocs はパスのパラメータの説明。書いていない名前は ULID の ID とみなす。
var pathParamDocs = map[string]string{
	"code":  "招待コード（22 文字）",
	"emoji": "絵文字（URL エンコードした文字）",
}

func (g *openAPIGen) paths(handlers map[string]string) (jsonObject, error) {
	// 同じパスの操作は 1 つのオブジェクトにまとめる。パスの並びは表で最初に出た順。
	var order []string
	byPath := map[string]*jsonObject{}
	for _, r := range apiRoutes {
		method, path, _ := strings.Cut(r.pattern, " ")
		op, err := g.operation(r, handlers[r.pattern], path)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", r.pattern, err)
		}
		item, ok := byPath[path]
		if !ok {
			item = &jsonObject{}
			byPath[path] = item
			order = append(order, path)
		}
		item.add(strings.ToLower(method), op)
	}
	var out jsonObject
	for _, p := range order {
		out.add(p, *byPath[p])
	}
	return out, nil
}

func (g *openAPIGen) operation(r apiRoute, handler, path string) (jsonObject, error) {
	if handler == "" {
		return nil, fmt.Errorf("not registered")
	}
	op := jsonObject{
		{"operationId", handler},
		{"tags", []string{r.tag}},
		{"summary", r.summary},
	}
	if r.description != "" {
		op.add("description", r.description)
	}

	var params []jsonObject
	for _, m := range pathParamRe.FindAllStringSubmatch(path, -1) {
		desc, ok := pathParamDocs[m[1]]
		if !ok {
			desc = "ID（ULID）"
		}
		params = append(params, jsonObject{
			{"name", m[1]}, {"in", "path"}, {"required", true}, {"description", desc},
			{"schema", jsonObject{{"type", "string"}}},
		})
	}
	for _, q := range r.query {
		p := jsonObject{{"name", q.name}, {"in", "query"}}
		if q.required {
			p.add("required", true)
		}
		if q.description != "" {
			p.add("description", q.description)
		}
		if q.repeated {
			p.add("schema", jsonObject{{"type", "array"}, {"items", jsonObject{{"type", q.typ}}}})
		} else {
			p.add("schema", jsonObject{{"type", q.typ}})
		}
		params = append(params, p)
	}
	if len(params) > 0 {
		op.add("parameters", params)
	}

	if r.request != nil {
		schema, err := g.ref(r.request)
		if err != nil {
			return nil, err
		}
		op.add("requestBody", jsonObject{
			{"required", !r.requestOptional},
			{"content", jsonObject{{"application/json", jsonObject{{"schema", schema}}}}},
		})
	}

	responses := jsonObject{}
	success := jsonObject{{"description", statusDescription(r.status, r.auth)}}
	if r.response != nil {
		schema, err := g.ref(r.response)
		if err != nil {
			return nil, err
		}
		success.add("content", jsonObject{{"application/json", jsonObject{{"schema", schema}}}})
	} else if r.rawMedia != "" {
		success.add("content", jsonObject{{r.rawMedia, jsonObject{{"schema", jsonObject{{"type", "object"}}}}}})
	}
	responses.add(strconv.Itoa(r.status), success)

	errors := slices.Clone(r.errors)
	if r.request != nil {
		// decodeJSON が Content-Type と大きさで止める（json.go）
		errors = append(errors, http.StatusUnsupportedMediaType, http.StatusRequestEntityTooLarge)
	}
	if r.auth != authNone {
		errors = append(errors, http.StatusUnauthorized)
	}
	if r.auth == authChatUser && !slices.Contains(errors, http.StatusForbidden) {
		errors = append(errors, http.StatusForbidden)
	}
	slices.Sort(errors)
	if len(errors) > 0 {
		problem, err := g.ref(reflect.TypeFor[problem]())
		if err != nil {
			return nil, err
		}
		for _, status := range errors {
			responses.add(strconv.Itoa(status), jsonObject{
				{"description", statusDescription(status, r.auth)},
				{"content", jsonObject{{"application/problem+json", jsonObject{{"schema", problem}}}}},
			})
		}
	}
	op.add("responses", responses)

	if r.auth != authNone {
		op.add("security", []jsonObject{{{"bearerAuth", []string{}}}})
	}
	return op, nil
}

func statusDescription(status int, auth apiAuth) string {
	switch status {
	case http.StatusBadRequest:
		return "リクエストが不正（本文やパラメータの形・値の検証に失敗した）"
	case http.StatusUnauthorized:
		return "認証されていない、または認証に失敗した"
	case http.StatusForbidden:
		if auth == authChatUser {
			return "権限がない。email を確認していない利用者もここで止める（email-unverified。ADR 0053）"
		}
		return "権限がない"
	case http.StatusNotFound:
		return "見つからない（存在しないことと、読めないことを区別しない）"
	case http.StatusConflict:
		return "いまの状態と競合する"
	case http.StatusRequestEntityTooLarge:
		return "本文が大きすぎる"
	case http.StatusUnsupportedMediaType:
		return "Content-Type が application/json ではない"
	case http.StatusUnprocessableEntity:
		return "値が不正（errors に項目ごとの理由が入る）"
	case http.StatusGone:
		return "もう使えない"
	case http.StatusTooManyRequests:
		return "回数の制限を超えた"
	case http.StatusServiceUnavailable:
		return "依存するサービスに接続できない"
	case http.StatusSwitchingProtocols:
		return "WebSocket に切り替えた"
	case http.StatusNoContent:
		return "成功（本文なし）"
	case http.StatusAccepted:
		return "受け付けた（本文なし）"
	}
	return http.StatusText(status)
}

// ref は型のスキーマを返す。登録した struct と enum は components への参照にする。
func (g *openAPIGen) ref(t reflect.Type) (any, error) {
	if name, ok := g.names[t]; ok {
		if _, seen := g.used[name]; !seen {
			g.used[name] = t
			g.queue = append(g.queue, t)
		}
		return jsonObject{{"$ref", "#/components/schemas/" + name}}, nil
	}
	switch t.Kind() {
	case reflect.Struct:
		if t == timeType {
			return jsonObject{{"type", "string"}, {"format", "date-time"}}, nil
		}
		return nil, fmt.Errorf("struct %s is not registered in tsDecls", t)
	case reflect.String:
		if t.Name() != "string" {
			return nil, fmt.Errorf("named string type %s is not registered in tsEnums", t)
		}
		return jsonObject{{"type", "string"}}, nil
	case reflect.Bool:
		return jsonObject{{"type", "boolean"}}, nil
	case reflect.Int, reflect.Int32, reflect.Int64, reflect.Uint, reflect.Uint32, reflect.Uint64:
		return jsonObject{{"type", "integer"}}, nil
	case reflect.Float64:
		return jsonObject{{"type", "number"}}, nil
	case reflect.Slice:
		items, err := g.ref(t.Elem())
		if err != nil {
			return nil, err
		}
		return jsonObject{{"type", "array"}, {"items", items}}, nil
	case reflect.Map:
		if t.Key().Kind() != reflect.String {
			return nil, fmt.Errorf("map key must be string: %s", t)
		}
		values, err := g.ref(t.Elem())
		if err != nil {
			return nil, err
		}
		return jsonObject{{"type", "object"}, {"additionalProperties", values}}, nil
	}
	return nil, fmt.Errorf("unsupported type %s", t)
}

// schemas は paths から参照した型を、参照をたどりながら components に出す。並びは名前の順。
func (g *openAPIGen) schemas() (jsonObject, error) {
	defs := map[string]any{}
	for len(g.queue) > 0 {
		t := g.queue[0]
		g.queue = g.queue[1:]
		name := g.names[t]
		if e, ok := g.enums[name]; ok {
			defs[name] = jsonObject{{"type", "string"}, {"enum", e.values}}
			continue
		}
		s, err := g.object(t)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", name, err)
		}
		defs[name] = s
	}
	var out jsonObject
	for _, name := range slices.Sorted(maps.Keys(defs)) {
		out.add(name, defs[name])
	}
	return out, nil
}

func (g *openAPIGen) object(t reflect.Type) (jsonObject, error) {
	request := false
	for _, d := range tsDecls {
		if d.typ == t {
			request = d.request
		}
	}
	fields, err := jsonFields(t, request)
	if err != nil {
		return nil, err
	}
	props := jsonObject{}
	var required []string
	for _, f := range fields {
		schema, err := g.fieldSchema(t, f)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", f.goName, err)
		}
		if f.nullable {
			schema = jsonObject{{"anyOf", []any{schema, jsonObject{{"type", "null"}}}}}
		}
		if doc := g.docs[f.goType+"."+f.goName]; doc != "" {
			// tsgen と同じく、Go のコメントの頭のフィールド名を JSON の名前に読み替える
			if rest, ok := strings.CutPrefix(doc, f.goName+" "); ok {
				doc = f.jsonName + " " + rest
			}
			if obj, ok := schema.(jsonObject); ok {
				schema = append(slices.Clone(obj), jsonMember{"description", doc})
			}
		}
		props.add(f.jsonName, schema)
		if !f.optional {
			required = append(required, f.jsonName)
		}
	}
	out := jsonObject{{"type", "object"}, {"properties", props}}
	if len(required) > 0 {
		out.add("required", required)
	}
	return out, nil
}

// fieldSchema は 1 つのフィールドのスキーマ。Go の型から決まらないものは tsFieldTypes と同じ上書きを使う。
func (g *openAPIGen) fieldSchema(t reflect.Type, f tsField) (any, error) {
	override, ok := tsFieldTypes[t.Name()+"."+f.jsonName]
	if !ok {
		return g.ref(f.typ)
	}
	if e, ok := g.enums[override]; ok {
		return g.ref(e.typ)
	}
	if override == "string" {
		return jsonObject{{"type", "string"}}, nil
	}
	if lit, err := strconv.Unquote(override); err == nil {
		return jsonObject{{"type", "string"}, {"const", lit}}, nil
	}
	return nil, fmt.Errorf("tsFieldTypes override %q has no OpenAPI mapping", override)
}
