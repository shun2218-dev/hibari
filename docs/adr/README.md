# Architecture Decision Records

設計判断を 1 件 1 ファイルで記録する。3 ヶ月後の自分が一番の読者。

- 一度「採用」にした ADR は書き換えない。判断を変えるときは新しい ADR を書き、古い方の状態を「置き換え済み（→ NNNN）」にする。
- 実装の途中で確定した詳細（例: seq の採番方式）は、該当する ADR の「追記」節に日付付きで足す。

| # | タイトル | 状態 |
|---|---|---|
| [0001](0001-auth-in-same-binary.md) | 認証を別サービスにせず同一バイナリに置く | 採用 |
| [0002](0002-message-ordering-by-seq.md) | メッセージの順序に seq を使い、timestamp を使わない | 採用 |
| [0003](0003-sqlc-over-orm.md) | ORM ではなく sqlc を使う | 採用 |
| [0004](0004-hybrid-delivery-ws-and-rest.md) | WebSocket と REST 差分取得のハイブリッド配信 | 採用 |
| [0005](0005-ulid-stored-as-uuid.md) | ULID を Postgres の uuid 型で保存する | 採用 |
| [0006](0006-workspaces-roles-invites.md) | ワークスペース層・固定ロール・招待リンク | 採用 |
| [0007](0007-session-revocation-and-ws-ticket.md) | セッション単位の失効と ws-ticket の置き場所 | 採用 |
| [0008](0008-object-storage-s3-api.md) | オブジェクトストレージを S3 API で抽象化する | 採用（本番ベンダーは暫定） |
| [0009](0009-diagram-rendering.md) | 図は mermaid を正本とし、SVG は mermaid-cli で生成する | 採用 |
| [0010](0010-auth-api-details.md) | 認証 API の詳細（トークンの形式と受け渡し、ローテーション、エラー形式） | 採用 |
| [0011](0011-chat-workspace-room-api.md) | ワークスペース / 招待 / ルーム API の詳細（Phase 3a） | 採用 |

## テンプレート

```markdown
# NNNN. タイトル

- 状態: 提案 / 採用 / 置き換え済み（→ NNNN）
- 日付: YYYY-MM-DD

## 背景
## 決定
## 理由
## 検討した代替案
## 結果（トレードオフ）
```
