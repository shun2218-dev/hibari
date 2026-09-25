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
| [0008](0008-object-storage-s3-api.md) | オブジェクトストレージを S3 API で抽象化する | 採用（本番は R2 に確定。ADR 0046。ローカルは RustFS に変更。追記） |
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
| [0040](0040-message-permalink-and-card.md) | メッセージへのリンクとカード（Phase 6.11 の前半。URL の形、見る人ごとに取るカード、長い本文の畳み） | 採用 |
| [0041](0041-mentions.md) | メンション（Phase 6.13。本文に ID で保存し、件数は行として積んで既読位置で数える） | 採用 |
| [0042](0042-jump-to-message.md) | 指定したメッセージへ飛ぶ（Phase 6.11b。前後を取る API、見つからないときの扱い、未読へ飛ぶ） | 採用 |
| [0043](0043-web-mentions.md) | メンションの Web 側（入力は `@ハンドル` で書き、送る直前に ID へ変換する） | 採用 |
| [0044](0044-message-reactions.md) | 絵文字のリアクション（Phase 6.7。行で持ち、メッセージの `change_seq` に乗せて配る） | 採用 |
| [0045](0045-attachment-lightbox-and-delete.md) | 添付ファイルの拡大表示と削除（Phase 6.7.5。画像はそのメッセージの中で送り、削除は `change_seq` に乗せる） | 採用 |
| [0046](0046-production-deployment.md) | 本番のデプロイ構成（Phase 7。Fly.io の 1 リージョンに寄せ、ストレージは R2。Postgres と Valkey は自前） | 採用 |
| [0047](0047-storybook.md) | `/dev/preview` を Storybook に移す（Phase 6.7.6。story id を PNG のパスにし、撮影と 1 対 1 の検査も移す） | 採用 |
| [0048](0048-resizable-panes.md) | パネルの幅はユーザーが変えられるようにし、入力欄は中身に合わせて 16 行まで伸ばす（大きさの正本は globals.css） | 採用 |
| [0049](0049-away-and-custom-status.md) | 離席とカスタムステータス（Phase 6.8。自動は Redis、本人の設定は DB。合わせるのは読む側） | 採用 |
| [0050](0050-profile-card.md) | プロフィールのカード（Phase 6.9。email は 1 人分の API だけが返し、管理の入口は既存の写しで決める） | 採用 |
| [0051](0051-message-formatting.md) | 本文の書式（Phase 6.10a。mrkdwn 寄りの記法をテキストのまま保存し、Web で解釈して React の要素で描く） | 採用 |
| [0052](0052-rich-text-composer.md) | リッチテキストの入力欄（Phase 6.10b。Lexical を使い、読み書きは ADR 0051 の解釈と自前の書き出しで行う） | 採用 |
| [0053](0053-require-verified-email.md) | 未検証の email ではチャットを使えないようにする（Phase 6.10.5。検証の状態はアクセストークンで渡し、メールは SMTP で非同期に送る） | 採用 |
| [0054](0054-pins-and-saved-messages.md) | ピン留めと保存（Phase 6.12。ピン留めはメッセージの change_seq、保存は本人ごとの change_seq で同期する） | 採用 |
| [0055](0055-mute-and-notification-settings.md) | ミュートと通知の設定（Phase 6.14a。本人が選んだ設定として DB に持ち、本人宛てのイベントで揃える） | 採用 |
| [0056](0056-thread-notifications.md) | スレッドの通知（Phase 6.14c。参加は残して「返信の通知」だけを切り替え、明示的なフォローを足す） | 採用 |
| [0057](0057-browser-notifications.md) | ブラウザ通知（Phase 6.14b。WebSocket で届いたメッセージを、クライアントが設定を読んで通知に変える） | 採用 |
| [0058](0058-sidebar-menu-and-activity.md) | サイドバーのメニューとアクティビティ（Phase 6.14.5。アクティビティは行を持たず、通知の規則と既読位置から導く） | 採用 |
| [0059](0059-room-archive-and-delete.md) | チャンネルのアーカイブと削除（Phase 6.15。アーカイブはルームの状態として authz が見る、削除は行ごと消してオブジェクトのキーだけを掃除の列に残す） | 採用 |
| [0060](0060-web-directory-layout.md) | web/ のディレクトリ構成（hooks と Provider を lib から出し、lib は React に依存しないものだけにする） | 採用 |
| [0061](0061-message-search.md) | メッセージの検索（Phase 6.16。pg_bigm の 2-gram 索引を「正規化した本文」に張り、authz は読めるルームの集合で絞る） | 採用 |
| [0062](0062-channel-links.md) | 本文の `#チャンネル名` をチャンネルへのリンクにする（本文には `<#ULID>` で保存し、名前は読む側が引く） | 採用 |
| [0063](0063-branding-and-page-metadata.md) | ブランドとページのメタデータ（タイトル・ファビコン・OGP・検索エンジン・LP。LP は apex に置き、`app.` は noindex） | 採用 |
| [0064](0064-documentation-site.md) | ドキュメントサイト（`docs.hibari-chat.com`。`docs/` を正本のまま Fumadocs で配り、REST の API リファレンスは Go の型から OpenAPI を生成する） | 採用 |
| [0065](0065-link-previews.md) | 外部のリンクのプレビュー（Phase 6.17。サーバーが取得してメッセージに固定し、画像とアイコンは自前のストレージに写す。入力欄でも出して消せる） | 採用 |
| [0066](0066-huddles.md) | 音声のハドル（Phase 6.18a。音声は DM も含めて必ず Cloudflare Realtime の SFU を通し、合図と参加の状態は Go が持つ。いま入っている人は Redis と心拍） | 提案 |

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
