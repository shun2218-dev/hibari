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
| [0012](0012-message-api.md) | メッセージ API の詳細（Phase 3b。冪等な送信、編集・削除の権限、履歴と既読） | 採用 |
| [0013](0013-attachment-api.md) | 添付ファイル API の詳細（Phase 3c。状態遷移、署名付き URL、受け付ける種類、掃除ジョブ） | 採用 |
| [0014](0014-message-change-seq.md) | 変更番号（change_seq）による差分同期 | 採用 |
| [0015](0015-websocket-hub-and-delivery.md) | WebSocket の Hub・購読・配信（Phase 4。購読の単位、Delivery、権限の再検証、presence / typing） | 採用 |
| [0016](0016-redis-pubsub-delivery.md) | Redis Pub/Sub による複数インスタンスの配信（Phase 5。チャンネル、購読の反映の待ち合わせ、presence、再接続の検知） | 採用 |
| [0017](0017-client-ip-and-trusted-proxies.md) | クライアント IP の決定と信頼するプロキシ（TRUSTED_PROXIES と X-Forwarded-For） | 採用 |
| [0018](0018-web-presentational-components.md) | Web クライアントの presentational コンポーネントと /dev/preview（Phase 6-1。境界、アバターの色、書体とアイコン） | 採用 |
| [0019](0019-session-list-and-profile-update.md) | セッションの一覧と失効、プロフィールの更新（Phase 6。設定画面に対応する API） | 採用 |
| [0020](0020-avatar-image.md) | アバター画像のアップロードと配布（Phase 6。署名付き PUT、まとめて署名する GET） | 採用 |
| [0021](0021-web-client-cors.md) | Web クライアントからの API の呼び方（Phase 6。直接呼んで CORS を許可、Web と API は同じサイト） | 採用 |
| [0022](0022-typescript-types-from-go.md) | Go の JSON の型から TypeScript の型を生成する（Phase 6。パッケージ内のテストが reflect で生成し、差分で落とす） | 採用 |
| [0023](0023-encoding-json-v2.md) | JSON の処理を encoding/json/v2 に統一する（Phase 6。nil のスライスを [] にし、読み込みを厳しくする） | 採用 |
| [0024](0024-web-session.md) | Web クライアントの認証の状態（Phase 6。Access Token はメモリ、Web Locks でタブ間の refresh を 1 本に、振り分けはブラウザで） | 採用 |
| [0025](0025-web-workspace-and-room-pages.md) | Web のワークスペースとルームの画面（Phase 6。ID の URL、最後に開いた場所、表示した所まで既読、開いた時点で未読の区切りを固定） | 採用 |
| [0026](0026-web-realtime-client.md) | Web の WebSocket クライアント（Phase 6。バックオフ + ジッターと ping、購読の ack の後に取り直す、タイムラインを残して差分で同期、見ている間だけ既読、外されたときの表示） | 採用 |
| [0027](0027-web-sending-messages.md) | Web のメッセージの送信（Phase 6。送信中は outgoing に持つ、ルームごとに 1 件ずつ送る、時間切れと同じ client_msg_id での再送、端末に保存しない、返信・編集・削除） | 採用 |
| [0028](0028-web-attachments-and-avatars.md) | Web の添付とアバターの表示（Phase 6。XHR で直接 PUT、uploaded を待ってから送信、許可リストにない種類は octet-stream で発行し直す、アバターはまとめて期限で取り直し、添付の画像は読み込みの失敗で取り直す） | 採用 |
| [0029](0029-web-workspace-admin.md) | Web のワークスペースの管理画面（Phase 6。URL、権限の写し、招待コードの扱い） | 採用 |
| [0030](0030-web-invite-accept.md) | Web の招待リンクの受け入れ（Phase 6。URL、ログインの振り分け、使えない招待の扱い） | 採用 |
| [0031](0031-web-user-settings.md) | Web のユーザー設定（Phase 6。プロフィール・アバター・デバイス・テーマ） | 採用 |
| [0032](0032-web-added-entry-points.md) | デザインに足した入口（Phase 6。DM・チャンネルの設定・チャットに戻る）と、実装から撮るスクリーンショット | 採用 |
| [0033](0033-system-messages.md) | システムメッセージ（Phase 6.4。参加・退出・作成・名前の変更をログに残し、未読は user_seq で数える） | 採用 |
| [0034](0034-web-leave-room.md) | チャンネルを自分で退出する入口（Phase 6） | 採用 |
| [0035](0035-web-removed-room-no-access.md) | 非公開チャンネルから外されたときは「アクセスできません」だけを出す（Phase 6） | 採用 |
| [0036](0036-threads.md) | スレッド（Phase 6.5。返信をタイムラインから分け、ルームの seq を共有し、未読は thread_seq で数える） | 採用 |
| [0037](0037-web-threads.md) | Web のスレッド（Phase 6.5。URL のクエリで開く、送信の列はルームで 1 本、バッジは手元の一覧から数える） | 採用 |
| [0038](0038-hide-deleted-messages.md) | 削除したメッセージを画面から消す（Slack と同じ。返信の残るスレッドの親だけ跡を残し、サイドバーはひとつ前のメッセージ） | 採用 |
| [0039](0039-thread-broadcast.md) | チャンネルにも投稿する（返信の行に「チャンネルに出す」を 1 列足し、チャンネルの発言として数える） | 採用 |
| [0040](0040-message-permalink-and-card.md) | メッセージへのリンクとカード（Phase 6.11 の前半。URL の形、見る人ごとに取るカード、長い本文の畳み） | 提案 |
| [0041](0041-mentions.md) | メンション（Phase 6.13。本文に ID で保存し、件数は行として積んで既読位置で数える） | 採用 |

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
