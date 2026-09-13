# 画面仕様（Phase 1.5）

Claude Design で作った画面を取り込んだもの。**Phase 6 で画面を実装するときの正本**で、ここにない画面や状態は発明しない（CLAUDE.md「デザイン」）。

- 色・文字サイズ・角丸などの値の正本は `web/app/globals.css`。各トークンの用途は [tokens.md](tokens.md)。
- スクリーンショットは Claude Design のプロジェクト「Hibari chat の画面設計」の `.dc.html` を headless Chrome で描画したもの（2026-09-13 時点）。デザインを変えたら撮り直す。手で加工しない。
- デザイン上の変数名（`--ink` / `--brand` / `--live` など）は使わない。`tokens.md` の対応表で `--color-*` に読み替える。

## 画面の構成

| ファイル（Claude Design） | 画面 | スクリーンショット |
|---|---|---|
| `hibari chat.dc.html` | サイドバー（ワークスペース切り替え・チャンネル / DM 一覧）、メッセージ、入力欄、メンバーパネル | `screenshots/chat/` |
| `hibari workspace.dc.html` | ワークスペース設定、メンバー管理、招待リンク、招待の受け入れ | `screenshots/workspace/`、`screenshots/invite/` |
| `hibari auth.dc.html` | ログイン、アカウント作成、パスワード再設定、メール確認 | `screenshots/auth/` |
| `hibari settings.dc.html` | プロフィール、ログイン中のデバイス、外観（テーマ・表示の密度） | `screenshots/settings/` |

デスクトップは 1280×800、モバイルは 390×844 で撮っている（`mobile-*`）。768px 未満でモバイルのレイアウト（一覧と詳細をスライドで切り替え、メンバーはボトムシート）になる。

## ロードマップの状態チェックリストとの対応

| 状態 | スクリーンショット |
|---|---|
| メッセージの送信中 / 送信済み / 送信失敗 / 削除済み（＋編集済み・返信・画像・ファイル） | `chat/messages-all-states.png`、`chat/messages-all-states-dark.png` |
| 送信失敗時の再送 UI | `chat/messages-all-states.png`（「再送する」「削除」） |
| 再接続中バナー、同期中バナー（＋復帰） | `chat/banner-reconnecting.png`、`chat/banner-syncing.png`、`chat/banner-restored.png` |
| 未読の区切り線 | `chat/default.png`（「ここから未読」「すべて既読にする」） |
| 入力中インジケータ | `chat/default.png`（入力欄の上） |
| ルームが 0 件 / メッセージが 0 件 | `chat/empty-rooms.png`、`chat/empty-messages.png` |
| ログイン失敗時のエラー（ユーザーの存在有無を明かさない） | `auth/login-error-credentials.png`、`auth/login-error-rate-limit.png` |
| ワークスペースの切り替え、作成 | `chat/workspace-switcher.png`、`chat/workspace-create-dialog.png` |
| 招待リンクの作成（使用回数・有効期限）、コードは 1 度だけ表示 | `workspace/dialog-invite-new.png`、`workspace/dialog-invite-created.png`、`workspace/invites-as-owner.png` |
| 招待リンクの受け入れ（プレビュー → 参加）、無効 / 期限切れ / 使用上限 | `invite/accept-preview.png`、`invite/accept-already.png`、`invite/accept-invalid.png`、`invite/accept-expired.png`、`invite/accept-maxed.png` |
| メンバー一覧、ロールの変更、キック、owner の譲渡 | `workspace/members-as-owner.png`、`workspace/member-menu-role-picker.png`、`workspace/dialog-kick.png`、`workspace/dialog-transfer-pick.png`、`workspace/dialog-transfer-confirm.png` |
| 権限不足で操作できない状態 | `workspace/member-menu-locked-reason.png`、`workspace/invites-as-member.png`、`workspace/settings-as-member.png`、`workspace/dialog-leave-blocked-owner.png` |
| public ルームを参加せずに閲覧（「参加して投稿する」導線） | `chat/public-preview.png` |
| キックされた / ルームから外された | `chat/removed-from-channel.png`、`chat/removed-from-workspace.png` |
| 添付ファイルのアップロード中 / 失敗 / 画像プレビュー | `chat/attachment-uploading.png`、`chat/attachment-failed.png`、`chat/attachment-done.png`、`chat/messages-all-states.png` |

チェックリスト外で追加された状態: サーバーに接続できない（`chat/server-error.png`）、チャンネル検索の 0 件、パスワード再設定とメール確認の各状態（`auth/`）、ログイン中のデバイス（`settings/devices.png`）。

## 取り込みの過程で設計に合わせて直したこと

最初のデザインは `docs/` の設計と食い違っていたので、Claude Design 側で次のように直してから取り込んだ。実装で元に戻さない。

| 最初のデザイン | 直した内容 | 根拠 |
|---|---|---|
| サイドバーが「ダイレクトメッセージ / グループ」、グループはアバターを重ねて表示 | 「チャンネル / ダイレクトメッセージ」。public は `#`、private は鍵アイコン | ADR 0006（グループ DM はスコープ外） |
| presence に離席（away）がある / オフラインの最終オンライン時刻を表示 | オンライン / オフラインの 2 状態だけ | presence は Redis の TTL だけで持つ（CLAUDE.md ルール 5） |
| メッセージのリアクション、ルーム内検索 | 削除 | データモデル・ロードマップにない |
| サーバーエラー画面の「送信していないメッセージはこの端末に残っています」 | 削除 | 端末へのメッセージ保存は設計にない |
| 設定の「通知」節 | 削除 | Push 通知は Phase 7 以降 |
| デバイス一覧の地名 | 削除 | `refresh_tokens` は `user_agent` と `ip` だけを持つ（GeoIP を使わない） |
| 「ユーザー名」 | 「ハンドル」 | `users.handle` |
| member から見たワークスペース設定で、名前と招待ポリシーが編集できる見た目だった | 読み取り専用にし、「変更できるのは管理者とオーナーだけ」と表示 | ADR 0006 の権限表 |
| 色・文字サイズ・角丸の直書き | トークンに集約。文字サイズ 7 段階、角丸 4 段階 | CLAUDE.md ルール 7 |

## 解決済み

- **パスワード再設定リンクの有効期限**: デザインの文言（1 時間）に合わせた（ADR 0010 追記）。

## 未解決（実装の前に決める）

- **招待リンク一覧の閲覧・取り消しの権限**: デザインでは member も一覧を閲覧でき、作成できる人は取り消しもできる。ADR 0006 の権限表に行がないので、Phase 3a の着手前に決める。
- **招待プレビューの項目**: `invite/accept-preview.png` はワークスペース名・メンバー数・チャンネル数・招待者を出している。`GET /api/v1/invites/{code}` のレスポンスに何を含めるかを Phase 3a で決める（非メンバーに見せてよい情報か）。
- **表示の密度「詰める」**: 設定画面に選択肢はあるが、行送りや余白の具体的な値がデザインにない。実装するならトークンを追加する前にデザインを足す。
- **書体の読み込み**: トークンは書体名だけを持つ。`next/font` での読み込みは Phase 6 で行う。
