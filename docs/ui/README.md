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
| member から見た招待一覧で、`invite_policy = all_members` のとき他人の招待にも「取り消す」が出ていた（2026-09-14 に修正） | 管理者以上か、自分が作成した招待にだけ出す。`workspace/invites-as-member-policy-all.png` を撮り直した | ADR 0011 |

## 解決済み

- **確認待ちの画面の「別のアドレスに変更する」**: email を変える API がないので出さない（`VerifyEmailPending` は `onChangeEmail` を渡したときだけ出す。`/dev/preview` ではスクリーンショットと同じく出している）。
- **パスワード再設定リンクの有効期限**: デザインの文言（1 時間）に合わせた（ADR 0010 追記）。
- **招待リンク一覧の閲覧・取り消しの権限**: 閲覧はメンバー全員、取り消しは admin 以上か、自分が作成した招待でいまも作成できる人（ADR 0011）。
- **招待プレビューの項目**: 要ログイン。有効な招待だけワークスペース名・メンバー数・public ルームの数・招待者・参加済みかを返し、無効 / 期限切れ / 使用上限ではワークスペースの情報を返さない（ADR 0011）。

- **書体の読み込み**: `next/font` で読み込む（`web/app/fonts.ts`、ADR 0018）。
- **招待リンクの長さ**: コードは 22 文字（ADR 0011）。作成直後のダイアログでは折り返さずに横へスクロールさせる（`InviteCreatedDialog`）。

## 画面の再現（Phase 6-1）

`make web` で起動し、`http://localhost:3000/dev/preview` を開く。スクリーンショットと同じ名前で全画面を並べてある（`/dev/preview/chat/banner-syncing` ↔ `screenshots/chat/banner-syncing.png`）。

- モバイルの画面（`mobile-*`）は、ブラウザの幅を 768px 未満にして見る。
- ダークの画面（`*-dark`）は、その画面だけ `data-theme="dark"` で描く。
- 画像の添付のストライプの模様は、モックの画像の中身なので再現していない（寸法の枠だけを出す）。
- スクリーンショットを足したら、`web/app/dev/preview/catalog.ts` と `screens.tsx` にも足す（足さないと `catalog.test.tsx` が落ちる）。

## 未解決（実装の前に決める）

- **表示の密度「詰める」**: 設定画面に選択肢はあるが、行送りや余白の具体的な値がデザインにない。実装するならトークンを追加する前にデザインを足す。いまは選択肢を出したまま選べないようにしてある（ADR 0031）。
- **サーバーに届かないときの認証まわりの表示**（Phase 6-2 で判明）: ログイン・登録の送信や、起動時のログイン状態の復元が通信の失敗や 500 になったときの画面がない。`chat/server-error.png` は接続できていたあとの切断用で、最終接続の時刻と再試行の回数を前提にしている。いまはフォームを戻すだけ・何も描かないにしている（ADR 0024）。
- **確認メールの再送の結果**（Phase 6-2 で判明）: `auth/verify-pending.png` で再送を押したあとの「送りました」や回数制限（429）の表示がない。いまはボタンを押せない間だけ変わる。
- **確認リンクを開いたあとの通信の失敗**（Phase 6-2 で判明）: `/verify-email` でサーバーに届かないときの画面がない。いまは確認中（`auth/verify-checking.png`）のままにしている。上の「サーバーに届かないときの認証まわりの表示」と一緒に決める。
- **チャットの画面の取得中と失敗**（Phase 6-2 の構築順 2 で判明）: ワークスペースやルームの一覧、履歴の取得中と取得の失敗、チャンネルの作成や参加の失敗（チャンネル名の重複 `room-name-taken` を含む）の表示がない。いまは何も描かないか、ダイアログやボタンを戻してコンソールに出すだけにしている（ADR 0025）。
- **送信・編集・削除の失敗の理由**（Phase 6-2 の構築順 4 で判明）: 本文が長すぎて送れない（4000 文字）、編集・削除の失敗、上位のロールの人のメッセージを削除できなかった（403）ことの表示がない。送信の失敗は `chat/messages-all-states.png` の「送信できませんでした」だけで、理由を出さない。いまは送信ボタンを押せなくする・ダイアログや編集欄を閉じるか戻すだけにしている（ADR 0027）。
- **添付だけのメッセージのサイドバーの 1 行**（ADR 0013 で先送り、Phase 6-2 の構築順 5 で判明）: 本文が空のメッセージが最後のとき、サイドバーに何を出すかがない。ルーム一覧の `last_message` に添付の情報がないので、いまは仮に「送信者: 添付ファイル」としている（ADR 0028）。ファイル名を出すなら API に足す。
- **添付のアップロードの失敗の理由と上限**（Phase 6-2 の構築順 5 で判明）: 大きすぎる（25 MiB）・種類が許可されていない・11 個目以降を選んだ、の表示がない。いまは失敗は「アップロードできませんでした」、11 個目以降は何も言わずに並べない（ADR 0028）。
- **画像の添付を押したとき**（Phase 6-2 の構築順 5 で判明）: 拡大表示やダウンロードの導線がデザインにない。いまは押しても何も起きない。
- **管理画面の操作の失敗**（Phase 6-2 の構築順 6 で判明）: ロールの変更・キック・譲渡・退出・招待の作成と取り消し・ワークスペース名や招待ポリシーの変更が失敗したときの表示がない。いまはサーバーの値に戻す（または何も起きない）だけで、コンソールに出す（ADR 0029）。招待リンクのコピーに失敗したときの表示もない。
- **招待リンクから登録した人の戻り先**（Phase 6-2 の構築順 6 で判明）: 登録すると「確認メールを送りました」（`auth/verify-pending.png`）で止まり、そこから招待の受け入れに戻る導線がない。メールの確認は必須ではない（ADR 0010）ので、いまはリンクをもう一度開いてもらう（ADR 0030）。
- **招待の受け入れの取得中と失敗**（Phase 6-2 の構築順 6 で判明）: `/j/{code}` を開いてからプレビューが返るまでの画面と、通信の失敗・500 の画面がない。いまは何も描かない。
- **設定の画面の失敗の表示**（Phase 6-2 の構築順 6 で判明）: ハンドルの重複（409）、表示名の入力エラー、アバターの画像が大きすぎる・種類が違う、セッションの一覧の取得の失敗の表示がない。いまは値を戻す・何も描かないだけで、コンソールに出す（ADR 0031）。
- **危険な操作のボタンの文字色**: `--color-on-danger` がないので、赤地のボタン（「削除する」「退出する」）の文字は `--color-on-primary` を使っている。ライト / ダークとも読めるが、役割の名前としては合っていない。

### Phase 6-1 で足した画面

Phase 6-1 で「API はあるのに操作の入口や状態の画面がない」ものを洗い出し、同じトークンでデザインして足した。
元のデザイン（`hibari chat.dc.html` など）とは別のキャンバスで作ったので、Claude Design 側に取り込むときはそちらに移す。

| 画面 | スクリーンショット | 関連する API |
|---|---|---|
| チャンネルを作成（公開範囲は作成時に決める） | `chat/channel-create-dialog.png` | `POST /workspaces/{id}/rooms` |
| ダイレクトメッセージを開く | `chat/dm-dialog.png` | `POST /workspaces/{id}/rooms`（kind: dm） |
| チャンネルの設定（名前・非公開のメンバー） | `chat/room-settings-dialog.png` | `PATCH /rooms/{id}`、`POST` / `DELETE /rooms/{id}/members` |
| メッセージの「…」メニュー | `chat/message-menu.png` | — |
| メッセージの編集中 | `chat/message-editing.png` | `PATCH /rooms/{id}/messages/{messageID}` |
| メッセージの削除の確認 | `chat/message-delete-dialog.png` | `DELETE /rooms/{id}/messages/{messageID}` |
| 返信先を選んだ入力欄 | `chat/composer-reply.png` | `POST /rooms/{id}/messages`（reply_to_id） |
| アカウントメニュー（ワークスペース設定 / 設定 / ログアウト） | `chat/account-menu.png` | `POST /auth/logout` |
| チャンネル検索の 0 件 | `chat/search-empty.png` | — |
| メンバーの「…」にキックの入口を足したもの | `workspace/member-menu-with-kick.png` | `DELETE /workspaces/{id}/members/{userID}` |
| プロフィールのアバター画像（あり / アップロード中 / 失敗） | `settings/profile-avatar.png`、`settings/profile-avatar-uploading.png`、`settings/profile-avatar-failed.png` | `POST` / `DELETE /users/me/avatar` |
| 一覧での画像のアバター（頭文字と混在） | `chat/avatar-images.png` | `POST /users/avatars` |

- この 10 枚は画面全体ではなく、足した部分だけを切り出したフレーム（他のスクリーンショットは 1280×800 の画面全体）。
- `workspace/member-menu-role-picker.png` はキックを足す前のメニュー。メニューの中身は `member-menu-with-kick.png` が新しい。
- 決めたこと: 公開範囲は作成後に変えられない（API に kind の変更がない）、DM は相手ひとりだけ（メンバーを追加できない）、チャンネルの削除は置かない（API がない）、ルームの設定を変えられるのは「そのルームを読める admin 以上」（ADR 0011）。
- アバター画像（ADR 0020）: 設定していない人はこれまでどおり頭文字と色。画像は円に切り取り（ワークスペースだけ角丸の四角）、読み込みに失敗したら頭文字に戻す。受け付けるのは PNG / JPEG / WebP で 2 MB まで。

### Phase 6-2 で足した画面

本番のページをつなぐ途中で見つかった抜け。Phase 6-1 と同じキャンバス（`hibari 追加画面`）に、既存の画面の部品をそのまま使って描いた。4 枚とも、足した部分だけを切り出したフレーム（幅 480）。

| 画面 | スクリーンショット | 関連する API |
|---|---|---|
| 再設定メールの依頼が回数制限になった | `auth/forgot-error-rate-limit.png` | `POST /auth/password-reset/request`（429） |
| 新しいパスワードが制約を満たさない | `auth/reset-error-invalid-input.png` | `POST /auth/password-reset/confirm`（422） |
| 確認リンクを開いて、結果を待っている | `auth/verify-checking.png` | `POST /auth/verify-email/confirm` |
| 所属するワークスペースが 0 件 | `chat/empty-workspaces.png` | `GET /workspaces` |

- 決めたこと: 再設定の失敗は、ログイン・登録と同じエラー枠（`Alert` の danger）をフォームの見出しの下に出す。文言もログインの回数制限と登録の入力エラーに合わせる。
- 回数制限はアカウントの有無に関係なく数えるので、出してもアカウントの有無は明かさない。
- ワークスペースが 0 件のときは、サイドバーに出すものがないので、チャットの画面ではなく認証と同じカードにする。「ワークスペースを作成」は既存の `chat/workspace-create-dialog.png` を開く。招待リンクから登録した人は受け入れの画面に戻るので、ここには来ない。

### Phase 6-2 の構築順 6 で足した画面

管理画面・設定・チャンネルの設定をつなぐときに見つかった「入口がない」ものを、既存の部品とトークンのまま足した。
**この 6 枚は Claude Design ではなく、実装（`/dev/preview`）を headless Chrome で撮ったもの**（`tools/shoot-ui.mjs`、`make web-shots`）。
Claude Design 側に取り込むときは、ほかの追加画面と同じキャンバスに移す。

| 画面 | スクリーンショット | 関連する API |
|---|---|---|
| サイドバーの見出しの「+」（チャンネルの作成 / DM を開く） | `chat/sidebar-add-entries.png`（320×560 の切り出し） | `POST /workspaces/{id}/rooms` |
| ルームのヘッダーの設定のボタン | `chat/room-header-settings.png`（900×120 の切り出し） | — |
| チャンネルにメンバーを追加（相手を選ぶ） | `chat/member-add-dialog.png` | `POST /rooms/{id}/members` |
| 管理画面からチャットに戻る | `workspace/back-to-chat.png` | — |
| 設定からチャットに戻る（デスクトップ / モバイル） | `settings/back-to-chat.png`、`settings/mobile-back-to-chat.png` | — |

- 「+」は見出しの右に置き、チャンネルと DM で同じ形にした。ルームが 0 件のときは一覧ごと出ないので、`chat/empty-rooms.png` の「チャンネルを作成」はそのまま残す。
- 「チャットに戻る」は、管理画面と設定の左のナビの上（デスクトップ）と、設定の一覧のヘッダー（モバイル）に置いた。管理画面のモバイルは、これまでどおりヘッダーの「戻る」がチャットに戻る。
- メンバーを追加する画面は、DM の相手を選ぶ画面（`chat/dm-dialog.png`）と同じ形にし、すでにチャンネルにいる人を候補から外す。
- **既存のスクリーンショット（Claude Design 由来）には、これらの「+」「設定」「チャットに戻る」がまだ写っていない。** Claude Design 側を直したら撮り直す。
### Phase 6.4 で足した画面

参加・退出・作成・名前の変更のログ（ADR 0033）は Phase 6 のデザインになかったので、既存の部品とトークンのまま足した。
実装（`/dev/preview`）を headless Chrome で撮ったもの。

| 画面 | スクリーンショット | 関連する API |
|---|---|---|
| 参加・名前の変更のログを挟んだタイムライン | `chat/system-messages.png` | `message.created`（`kind: "system"`） |

- ログは人の発言ではないので、アバターも名前も出さず、日付の区切りと同じ中央寄せの控えめな 1 行にする。続けて表示（grouped）の基準にもしない。
- 文言は「{主語} が〜しました」。サーバーは種類とそのときの名前だけを返し、文言はクライアントが作る。
- サイドバーの最後の 1 行にも、同じ文言をそのまま出す（送信者の名前は前に付けない）。

### 画面はあるが API がなかったもの（Phase 6 で追加した）

| 画面 | 追加した API |
|---|---|
| `settings/devices.png`（ログイン中のデバイスの一覧・個別のログアウト・他のすべてのログアウト） | セッションの一覧と失効（ADR 0019） |
| `settings/profile.png`（表示名・ハンドルの変更） | プロフィールの更新（ADR 0019） |
| `settings/profile-avatar*.png`（画像の変更・削除） | アバター画像のアップロードと配布（ADR 0020） |
