package db

import (
	"errors"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/oklog/ulid/v2"
)

// RegisterTypes は、Postgres の uuid 型と ulid.ULID を相互に変換できるようにする（ADR 0005）。
//
// なぜ必要か: ulid.ULID は sql.Scanner を実装しているが、pgx はそこに uuid の「テキスト表現」
// （ハイフン付きの 36 文字）を渡すので、ulid 側が 16 バイトを期待して失敗する。
// 書き込みは偶然通るが、読み出しで壊れる。変換をここ 1 箇所に閉じ込め、
// sqlc の生成コードとドメイン層は ulid.ULID だけを扱えばよい状態にする。
//
// 中身はどちらも 128 ビットなので、pgtype.UUID を経由してバイト列をそのまま詰め替える。
func RegisterTypes(m *pgtype.Map) {
	uuidType := &pgtype.Type{Name: "uuid", OID: pgtype.UUIDOID, Codec: ulidCodec{}}
	m.RegisterType(uuidType)
	// 配列型（uuid[]）は要素の Codec を参照で持つので、要素を差し替えたら配列も登録し直す。
	// これがないと `= ANY($1::uuid[])` に []ulid.ULID を渡せない。
	m.RegisterType(&pgtype.Type{Name: "_uuid", OID: pgtype.UUIDArrayOID, Codec: &pgtype.ArrayCodec{ElementType: uuidType}})
	// パラメータの型を DB に問い合わせない実行モード（QueryExecModeExec / SimpleProtocol）では、
	// pgx は Go の型から OID を推測する。登録しないと ulid.ULID の driver.Valuer（16 バイトの []byte）が
	// テキストとして送られて壊れる。
	m.RegisterDefaultPgType(ulid.ULID{}, "uuid")
	m.RegisterDefaultPgType(&ulid.ULID{}, "uuid")
	m.RegisterDefaultPgType([]ulid.ULID{}, "_uuid")
}

// ulidCodec は pgtype.UUIDCodec に ulid.ULID の読み書きを足したもの。
// それ以外の型（pgtype.UUID、string など）は元の UUIDCodec にそのまま任せる。
type ulidCodec struct {
	pgtype.UUIDCodec
}

func (c ulidCodec) PlanEncode(m *pgtype.Map, oid uint32, format int16, value any) pgtype.EncodePlan {
	switch value.(type) {
	case ulid.ULID, *ulid.ULID:
		next := c.UUIDCodec.PlanEncode(m, oid, format, pgtype.UUID{})
		if next == nil {
			return nil
		}
		return encodePlanULID{next: next}
	}
	return c.UUIDCodec.PlanEncode(m, oid, format, value)
}

func (c ulidCodec) PlanScan(m *pgtype.Map, oid uint32, format int16, target any) pgtype.ScanPlan {
	if _, ok := target.(*ulid.ULID); ok {
		next := c.UUIDCodec.PlanScan(m, oid, format, &pgtype.UUID{})
		if next == nil {
			return nil
		}
		return scanPlanULID{next: next}
	}
	return c.UUIDCodec.PlanScan(m, oid, format, target)
}

type encodePlanULID struct {
	next pgtype.EncodePlan
}

func (p encodePlanULID) Encode(value any, buf []byte) ([]byte, error) {
	var u pgtype.UUID
	switch v := value.(type) {
	case ulid.ULID:
		u = pgtype.UUID{Bytes: v, Valid: true}
	case *ulid.ULID:
		if v != nil {
			u = pgtype.UUID{Bytes: *v, Valid: true}
		}
	}
	return p.next.Encode(u, buf)
}

type scanPlanULID struct {
	next pgtype.ScanPlan
}

// errScanNullULID は、NULL を非ポインタの ulid.ULID に読もうとしたときに返す。
// NULL になりうる列は *ulid.ULID で受ける（pgx がポインタを nil にしてくれる）。
var errScanNullULID = errors.New("cannot scan NULL into ulid.ULID; use *ulid.ULID")

func (p scanPlanULID) Scan(src []byte, target any) error {
	var u pgtype.UUID
	if err := p.next.Scan(src, &u); err != nil {
		return err
	}
	if !u.Valid {
		return errScanNullULID
	}
	*target.(*ulid.ULID) = ulid.ULID(u.Bytes)
	return nil
}
