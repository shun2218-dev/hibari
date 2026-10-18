# hibari

hibari は Go 製のリアルタイムチャットアプリ。Slack / Discord と同じく「ワークスペース → チャンネル」の構成を持つ。

WebSocket を使ったリアルタイムの設計を、自分で実装して学ぶためのプロジェクトでもある。
「動けばいい」ではなく、なぜその設計なのかをコードのコメントと設計判断の記録（ADR）に残している。このサイトはその記録を読むための入口。

## 全体の構成

![アーキテクチャ](../architecture.svg)

- **1 つの Go のバイナリに、認証（auth）とチャット（chat）が同居する。** パッケージは厳密に分け、chat は auth を import しない（[ADR 0001](../adr/0001-auth-in-same-binary.md)）。
- **メッセージの順序は、ルームごとに採番する `seq` だけで決める。** 作った時刻では並べない（[ADR 0002](../adr/0002-message-ordering-by-seq.md)）。
- **配信は WebSocket だけに頼らない。** 再接続したら、最後に受け取った `seq` から REST で差分を取る。Redis Pub/Sub は落ちうる前提で設計する（[ADR 0004](../adr/0004-hybrid-delivery-ws-and-rest.md)、[ADR 0016](../adr/0016-redis-pubsub-delivery.md)）。
- **ファイルの中身はサーバーを通さない。** クライアントが署名付き URL でストレージに直接置く（[ADR 0008](../adr/0008-object-storage-s3-api.md)、[ADR 0013](../adr/0013-attachment-api.md)）。

## 技術スタック

| 層 | 使っているもの |
|---|---|
| サーバー | Go、`net/http` の `ServeMux`、`coder/websocket`、`log/slog` |
| データ | PostgreSQL 16（`pgx`、`sqlc`、`goose`）、Redis（presence・typing・Pub/Sub）、S3 互換のストレージ |
| 認証 | Argon2id、JWT（Access Token）と、ローテーションする Refresh Token |
| Web | Next.js（App Router）、TypeScript、Tailwind CSS、入力欄は Lexical |
| 本番 | Fly.io、ストレージは Cloudflare R2（[ADR 0046](../adr/0046-production-deployment.md)） |

## 読み方

- **バックエンド**: REST の API リファレンスは Go の型から生成している（[ADR 0064](../adr/0064-documentation-site.md)）。WebSocket のイベントは [WebSocket イベント](../events.md)。
- **フロントエンド**: 色や文字の大きさの使い分けは [デザイントークン](../ui/tokens.md)、画面の正本は [画面仕様](../ui/README.md)。部品は Storybook で見られる。
- **設計判断**: [ADR の一覧](../adr/README.md)。1 件 1 ファイルで、判断を変えるときは新しい ADR を書く。
- **計画**: 何をどの順で作ってきたかは [ロードマップ](../roadmap.md)。
