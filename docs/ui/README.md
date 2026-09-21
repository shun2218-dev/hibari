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
| メッセージの送信中 / 送信済み / 送信失敗 / 削除済み（＋編集済み・返信・画像・ファイル） | `chat/timeline/messages-all-states.png`、`chat/timeline/messages-all-states-dark.png` |
| 送信失敗時の再送 UI | `chat/timeline/messages-all-states.png`（「再送する」「削除」） |
| 再接続中バナー、同期中バナー（＋復帰） | `chat/connection/banner-reconnecting.png`、`chat/connection/banner-syncing.png`、`chat/connection/banner-restored.png` |
| 未読の区切り線 | `chat/timeline/default.png`（「ここから未読」「すべて既読にする」） |
| 入力中インジケータ | `chat/timeline/default.png`（入力欄の上） |
| ルームが 0 件 / メッセージが 0 件 | `chat/room/empty-rooms.png`、`chat/timeline/empty-messages.png` |
| ログイン失敗時のエラー（ユーザーの存在有無を明かさない） | `auth/signin/login-error-credentials.png`、`auth/signin/login-error-rate-limit.png` |
| ワークスペースの切り替え、作成 | `chat/workspace/workspace-switcher.png`、`chat/workspace/workspace-create-dialog.png` |
| 招待リンクの作成（使用回数・有効期限）、コードは 1 度だけ表示 | `workspace/invite/dialog-invite-new.png`、`workspace/invite/dialog-invite-created.png`、`workspace/invite/invites-as-owner.png` |
| 招待リンクの受け入れ（プレビュー → 参加）、無効 / 期限切れ / 使用上限 | `invite/accept/accept-preview.png`、`invite/accept/accept-already.png`、`invite/accept/accept-invalid.png`、`invite/accept/accept-expired.png`、`invite/accept/accept-maxed.png` |
| メンバー一覧、ロールの変更、キック、owner の譲渡 | `workspace/member/members-as-owner.png`、`workspace/member/member-menu-role-picker.png`、`workspace/member/dialog-kick.png`、`workspace/settings/dialog-transfer-pick.png`、`workspace/settings/dialog-transfer-confirm.png` |
| 権限不足で操作できない状態 | `workspace/member/member-menu-locked-reason.png`、`workspace/invite/invites-as-member.png`、`workspace/settings/settings-as-member.png`、`workspace/settings/dialog-leave-blocked-owner.png` |
| public ルームを参加せずに閲覧（「参加して投稿する」導線） | `chat/room/public-preview.png` |
| キックされた / ルームから外された | `chat/room/removed-from-channel.png`、`chat/workspace/removed-from-workspace.png` |
| 添付ファイルのアップロード中 / 失敗 / 画像プレビュー | `chat/attachment/attachment-uploading.png`、`chat/attachment/attachment-failed.png`、`chat/attachment/attachment-done.png`、`chat/timeline/messages-all-states.png` |

チェックリスト外で追加された状態: サーバーに接続できない（`chat/connection/server-error.png`）、チャンネル検索の 0 件、パスワード再設定とメール確認の各状態（`auth/`）、ログイン中のデバイス（`settings/devices/devices.png`）。

## 取り込みの過程で設計に合わせて直したこと

最初のデザインは `docs/` の設計と食い違っていたので、Claude Design 側で次のように直してから取り込んだ。実装で元に戻さない。

| 最初のデザイン | 直した内容 | 根拠 |
|---|---|---|
| サイドバーが「ダイレクトメッセージ / グループ」、グループはアバターを重ねて表示 | 「チャンネル / ダイレクトメッセージ」。public は `#`、private は鍵アイコン | ADR 0006（グループ DM はスコープ外） |
| presence に離席（away）がある / オフラインの最終オンライン時刻を表示 | 最終オンライン時刻だけ削除（離席は Phase 6.8 で足した） | 「いつから見ていないか」は他人に見せない。離席は ADR 0049 |
| メッセージのリアクション、ルーム内検索 | 削除 | データモデル・ロードマップにない |
| サーバーエラー画面の「送信していないメッセージはこの端末に残っています」 | 削除 | 端末へのメッセージ保存は設計にない |
| 設定の「通知」節 | 削除 | Push 通知は Phase 7 以降 |
| デバイス一覧の地名 | 削除 | `refresh_tokens` は `user_agent` と `ip` だけを持つ（GeoIP を使わない） |
| 「ユーザー名」 | 「ハンドル」 | `users.handle` |
| member から見たワークスペース設定で、名前と招待ポリシーが編集できる見た目だった | 読み取り専用にし、「変更できるのは管理者とオーナーだけ」と表示 | ADR 0006 の権限表 |
| 色・文字サイズ・角丸の直書き | トークンに集約。文字サイズ 7 段階、角丸 4 段階 | CLAUDE.md ルール 7 |
| member から見た招待一覧で、`invite_policy = all_members` のとき他人の招待にも「取り消す」が出ていた（2026-09-14 に修正） | 管理者以上か、自分が作成した招待にだけ出す。`workspace/invite/invites-as-member-policy-all.png` を撮り直した | ADR 0011 |

## 解決済み

- **確認待ちの画面の「別のアドレスに変更する」**: email を変える API がないので出さない（`VerifyEmailPending` は `onChangeEmail` を渡したときだけ出す。story ではスクリーンショットと同じく出している）。
- **パスワード再設定リンクの有効期限**: デザインの文言（1 時間）に合わせた（ADR 0010 追記）。
- **招待リンク一覧の閲覧・取り消しの権限**: 閲覧はメンバー全員、取り消しは admin 以上か、自分が作成した招待でいまも作成できる人（ADR 0011）。
- **招待プレビューの項目**: 要ログイン。有効な招待だけワークスペース名・メンバー数・public ルームの数・招待者・参加済みかを返し、無効 / 期限切れ / 使用上限ではワークスペースの情報を返さない（ADR 0011）。

- **書体の読み込み**: `next/font` で読み込む（`web/app/fonts.ts`、ADR 0018）。
- **招待リンクの長さ**: コードは 22 文字（ADR 0011）。作成直後のダイアログでは折り返さずに横へスクロールさせる（`InviteCreatedDialog`）。

## 画面の再現（Storybook。Phase 6.7.6 まで `/dev/preview`）

`make web-ui` で Storybook（`http://localhost:6006`）を起動する。**story の id がそのままスクリーンショットのパス**で、
`chat-connection--banner-syncing` ↔ `screenshots/chat/connection/banner-syncing.png` のように 1 対 1 に対応する（ADR 0047）。
サイドバーの検索で名前から探せて、`since:6.7` のような tag でフェーズごとに絞り込める。

- story は `web/stories/<グループ>/<サブグループ>.stories.tsx`、画面の組み立ては `web/stories/screens.tsx`、モックは `web/stories/fixtures.ts`。
  **ファイルの置き場所は PNG のディレクトリと同じ**（`web/stories/chat/thread.stories.tsx` ↔ `screenshots/chat/thread/`）。
- モバイルの画面（`mobile-*`）は 390x844 の viewport で描く。ダークの画面（`*-dark`）は `parameters.theme: "dark"` を付ける。
- 画像の添付のストライプの模様は、モックの画像の中身なので再現していない（寸法の枠だけを出す）。
  拡大表示の画面（Phase 6.7.5）だけは中身が要るので、モックの画像を `web/public/dev/photo-*.png` に置いてある（アバターの画像と同じ扱い）。
- スクリーンショットを足したら story も足す（足さないと `web/stories/stories.test.tsx` の 1 対 1 の検査が落ちる）。
  export 名がそのままファイル名になるので、`ImageViewerDark` → `chat/attachment/image-viewer-dark.png`。

### 部品のカタログ

画面の story とは別に、**部品ごとの story**（`web/components/**/*.stories.tsx`）がある（ADR 0047 決定 12）。
こちらは PNG と対にならない。props を controls で変えられ、`autodocs` で props の表が出て、テーマはツールバーで切り替えられる。

- `components/ui/`: `Button` / `Alert` / `Avatar` / `Badge` / `Field` / `Choice` / `Dialog` / `Spinner` / `Link` / `Icons`。
  トークンの使い方（緑＝操作できるもの、琥珀＝いま起きていること）を目で確かめる場所でもある（`tokens.md`）。
- 状態の軸がある部品: `MessageItem`（送信中 / 失敗 / 削除 / 編集済み）、`Composer`（添付と `@` の補完）、
  `ConnectionBanner`、`MessageReactions`、`MessageLinkCard`、`InviteAccept`。
- `Timeline` や `Sidebar` のような大きい部品は作らない（画面の story とほぼ同じものが二重になるため）。

**画面と部品は `screenshot` の tag で見分ける。** 画面の story だけがこの tag を持ち、撮影と 1 対 1 の検査の対象になる。

### スクリーンショットの置き場所

話題ごとにディレクトリを分けてある（ADR 0047 決定 2）。**ディレクトリの名前は英小文字の 1 語**にする
（story の id から戻すときに `-` で区切るため、ハイフンを使わない）。

| ディレクトリ | 中身 |
|---|---|
| `auth/signin` / `auth/password` / `auth/verify` | ログインと登録 / パスワードの再設定 / メールの確認 |
| `chat/timeline` | タイムライン、システムメッセージ、アバター、0 件 |
| `chat/message` | メッセージの「…」・編集・削除 |
| `chat/attachment` | 添付のアップロード、拡大表示、添付だけの削除 |
| `chat/reaction` | 絵文字のリアクションとピッカー |
| `chat/thread` | スレッドのパネル、参加しているスレッドの一覧、チャンネルにも投稿 |
| `chat/mention` | メンションと `@` の補完 |
| `chat/link` | リンクのカード、未読へ飛ぶ、飛んだ先の強調 |
| `chat/room` | チャンネルの作成・設定・退出、メンバー、サイドバー |
| `chat/workspace` | ワークスペースの切り替え・作成、アカウントメニュー |
| `chat/connection` | 再接続・同期・復帰のバナー、サーバーに接続できない |
| `invite/accept` | 招待リンクを開いたとき（有効・参加済み・無効・期限切れ・上限） |
| `workspace/settings` / `workspace/member` / `workspace/invite` | 管理画面の 3 つの節 |
| `settings/profile` / `settings/devices` / `settings/appearance` / `settings/nav` | ユーザー設定の 3 つの節と、チャットに戻る導線 |

枚数が少なくても分ける（`invite` は 5 枚、`settings/appearance` は 1 枚）。Storybook のサイドバーの並びが揃うため。

モバイルの画面は別にまとめず、同じ話題の中に置く（`chat/thread/mobile-thread.png`）。
デスクトップと並べて見比べるのがふだんの使い方なので、離さない。

### 撮り直し

`make web-ui` を動かしたまま、別の端末で:

```
make web-shots                                   # source: "app" の PNG を全部
make web-shots names="chat/room-header-settings" # 名前を指定して 1 枚だけ
```

- 撮る大きさは story の `parameters.screenshot.size`（既定は 1280x800、モバイルは 390x844）。
- Claude Design から取り込んだ PNG には `source: "design"` を付けてあり、撮り直しの対象にしない
  （実装から撮ったものではないので、撮り直すと必ず差が出る）。
- 入力中の「…」のような動くものは、読み込みの前に `animation: none` を入れて最初から動かさない
  （途中で止めると「いつ止めたか」で結果が変わるため）。画像と書体の読み込みも待つ。同じ story を 2 回撮れば同じ PNG になる。

## 未解決（実装の前に決める）

- **表示の密度「詰める」**: 設定画面に選択肢はあるが、行送りや余白の具体的な値がデザインにない。実装するならトークンを追加する前にデザインを足す。いまは選択肢を出したまま選べないようにしてある（ADR 0031）。
- **サーバーに届かないときの認証まわりの表示**（Phase 6-2 で判明）: ログイン・登録の送信や、起動時のログイン状態の復元が通信の失敗や 500 になったときの画面がない。`chat/connection/server-error.png` は接続できていたあとの切断用で、最終接続の時刻と再試行の回数を前提にしている。いまはフォームを戻すだけ・何も描かないにしている（ADR 0024）。
- **確認メールの再送の結果**（Phase 6-2 で判明）: `auth/verify/verify-pending.png` で再送を押したあとの「送りました」や回数制限（429）の表示がない。いまはボタンを押せない間だけ変わる。
- **確認リンクを開いたあとの通信の失敗**（Phase 6-2 で判明）: `/verify-email` でサーバーに届かないときの画面がない。いまは確認中（`auth/verify/verify-checking.png`）のままにしている。上の「サーバーに届かないときの認証まわりの表示」と一緒に決める。
- **チャットの画面の取得中と失敗**（Phase 6-2 の構築順 2 で判明）: ワークスペースやルームの一覧、履歴の取得中と取得の失敗、チャンネルの作成や参加の失敗（チャンネル名の重複 `room-name-taken` を含む）の表示がない。いまは何も描かないか、ダイアログやボタンを戻してコンソールに出すだけにしている（ADR 0025）。
- **送信・編集・削除の失敗の理由**（Phase 6-2 の構築順 4 で判明）: 本文が長すぎて送れない（4000 文字）、編集・削除の失敗、上位のロールの人のメッセージを削除できなかった（403）ことの表示がない。送信の失敗は `chat/timeline/messages-all-states.png` の「送信できませんでした」だけで、理由を出さない。いまは送信ボタンを押せなくする・ダイアログや編集欄を閉じるか戻すだけにしている（ADR 0027）。
- **添付だけのメッセージのサイドバーの 1 行**（ADR 0013 で先送り、Phase 6-2 の構築順 5 で判明）: 本文が空のメッセージが最後のとき、サイドバーに何を出すかがない。ルーム一覧の `last_message` に添付の情報がないので、いまは仮に「送信者: 添付ファイル」としている（ADR 0028）。ファイル名を出すなら API に足す。
- **添付のアップロードの失敗の理由と上限**（Phase 6-2 の構築順 5 で判明）: 大きすぎる（25 MiB）・種類が許可されていない・11 個目以降を選んだ、の表示がない。いまは失敗は「アップロードできませんでした」、11 個目以降は何も言わずに並べない（ADR 0028）。
- **画像の添付を押したとき**（Phase 6-2 の構築順 5 で判明）: 拡大表示やダウンロードの導線がデザインにない。いまは押しても何も起きない。→ **Phase 6.7.5 で作る**（ADR 0045）。添付ファイルだけを削除する導線も、そこで一緒に足す。
- **管理画面の操作の失敗**（Phase 6-2 の構築順 6 で判明）: ロールの変更・キック・譲渡・退出（ワークスペースとチャンネル）・招待の作成と取り消し・ワークスペース名や招待ポリシーの変更が失敗したときの表示がない。いまはサーバーの値に戻す（または何も起きない）だけで、コンソールに出す（ADR 0029）。招待リンクのコピーに失敗したときの表示もない。
- **招待リンクから登録した人の戻り先**（Phase 6-2 の構築順 6 で判明）: 登録すると「確認メールを送りました」で止まり、招待の受け入れに戻る導線がなかった（ADR 0030）。→ **Phase 6.10.5 で解決**（ADR 0053 決定 3）。確認メールのリンクに戻り先を載せ、「hibari を開く」で招待の画面に戻る。
- **招待の受け入れの取得中と失敗**（Phase 6-2 の構築順 6 で判明）: `/j/{code}` を開いてからプレビューが返るまでの画面と、通信の失敗・500 の画面がない。いまは何も描かない。
- **設定の画面の失敗の表示**（Phase 6-2 の構築順 6 で判明）: ハンドルの重複（409）、表示名の入力エラー、アバターの画像が大きすぎる・種類が違う、セッションの一覧の取得の失敗の表示がない。いまは値を戻す・何も描かないだけで、コンソールに出す（ADR 0031）。
- **危険な操作のボタンの文字色**: `--color-on-danger` がないので、赤地のボタン（「削除する」「退出する」）の文字は `--color-on-primary` を使っている。ライト / ダークとも読めるが、役割の名前としては合っていない。

### Phase 6-1 で足した画面

Phase 6-1 で「API はあるのに操作の入口や状態の画面がない」ものを洗い出し、同じトークンでデザインして足した。
元のデザイン（`hibari chat.dc.html` など）とは別のキャンバスで作ったので、Claude Design 側に取り込むときはそちらに移す。

| 画面 | スクリーンショット | 関連する API |
|---|---|---|
| チャンネルを作成（公開範囲は作成時に決める） | `chat/room/channel-create-dialog.png` | `POST /workspaces/{id}/rooms` |
| ダイレクトメッセージを開く | `chat/room/dm-dialog.png` | `POST /workspaces/{id}/rooms`（kind: dm） |
| チャンネルの設定（名前・非公開のメンバー） | `chat/room/room-settings-dialog.png` | `PATCH /rooms/{id}`、`POST` / `DELETE /rooms/{id}/members` |
| メッセージの「…」メニュー | `chat/message/message-menu.png` | — |
| メッセージの編集中 | `chat/message/message-editing.png` | `PATCH /rooms/{id}/messages/{messageID}` |
| メッセージの削除の確認 | `chat/message/message-delete-dialog.png` | `DELETE /rooms/{id}/messages/{messageID}` |
| アカウントメニュー（ワークスペース設定 / 設定 / ログアウト） | `chat/workspace/account-menu.png` | `POST /auth/logout` |
| チャンネル検索の 0 件 | `chat/room/search-empty.png` | — |
| メンバーの「…」にキックの入口を足したもの | `workspace/member/member-menu-with-kick.png` | `DELETE /workspaces/{id}/members/{userID}` |
| プロフィールのアバター画像（あり / アップロード中 / 失敗） | `settings/profile/profile-avatar.png`、`settings/profile/profile-avatar-uploading.png`、`settings/profile/profile-avatar-failed.png` | `POST` / `DELETE /users/me/avatar` |
| 一覧での画像のアバター（頭文字と混在） | `chat/timeline/avatar-images.png` | `POST /users/avatars` |

- この 10 枚は画面全体ではなく、足した部分だけを切り出したフレーム（他のスクリーンショットは 1280×800 の画面全体）。
- `workspace/member/member-menu-role-picker.png` はキックを足す前のメニュー。メニューの中身は `member-menu-with-kick.png` が新しい。
- 決めたこと: 公開範囲は作成後に変えられない（API に kind の変更がない）、DM は相手ひとりだけ（メンバーを追加できない）、チャンネルの削除は置かない（API がない）、ルームの設定を変えられるのは「そのルームを読める admin 以上」（ADR 0011）。
- アバター画像（ADR 0020）: 設定していない人はこれまでどおり頭文字と色。画像は円に切り取り（ワークスペースだけ角丸の四角）、読み込みに失敗したら頭文字に戻す。受け付けるのは PNG / JPEG / WebP で 2 MB まで。

### Phase 6-2 で足した画面

本番のページをつなぐ途中で見つかった抜け。Phase 6-1 と同じキャンバス（`hibari 追加画面`）に、既存の画面の部品をそのまま使って描いた。4 枚とも、足した部分だけを切り出したフレーム（幅 480）。

| 画面 | スクリーンショット | 関連する API |
|---|---|---|
| 再設定メールの依頼が回数制限になった | `auth/password/forgot-error-rate-limit.png` | `POST /auth/password-reset/request`（429） |
| 新しいパスワードが制約を満たさない | `auth/password/reset-error-invalid-input.png` | `POST /auth/password-reset/confirm`（422） |
| 確認リンクを開いて、結果を待っている | `auth/verify/verify-checking.png` | `POST /auth/verify-email/confirm` |
| 所属するワークスペースが 0 件 | `chat/workspace/empty-workspaces.png` | `GET /workspaces` |

- 決めたこと: 再設定の失敗は、ログイン・登録と同じエラー枠（`Alert` の danger）をフォームの見出しの下に出す。文言もログインの回数制限と登録の入力エラーに合わせる。
- 回数制限はアカウントの有無に関係なく数えるので、出してもアカウントの有無は明かさない。
- ワークスペースが 0 件のときは、サイドバーに出すものがないので、チャットの画面ではなく認証と同じカードにする。「ワークスペースを作成」は既存の `chat/workspace/workspace-create-dialog.png` を開く。招待リンクから登録した人は受け入れの画面に戻るので、ここには来ない。

### Phase 6-2 の構築順 6 で足した画面

管理画面・設定・チャンネルの設定をつなぐときに見つかった「入口がない」ものを、既存の部品とトークンのまま足した。
**この 6 枚は Claude Design ではなく、実装を headless Chrome で撮ったもの**（`tools/shoot-ui.mjs`、`make web-shots`）。
Claude Design 側に取り込むときは、ほかの追加画面と同じキャンバスに移す。

| 画面 | スクリーンショット | 関連する API |
|---|---|---|
| サイドバーの見出しの「+」（チャンネルの作成 / DM を開く） | `chat/room/sidebar-add-entries.png`（320×560 の切り出し） | `POST /workspaces/{id}/rooms` |
| ルームのヘッダーの設定のボタン | `chat/room/room-header-settings.png`（900×120 の切り出し） | — |
| チャンネルにメンバーを追加（相手を選ぶ） | `chat/room/member-add-dialog.png` | `POST /rooms/{id}/members` |
| 管理画面からチャットに戻る | `workspace/settings/nav/back-to-chat.png` | — |
| 設定からチャットに戻る（デスクトップ / モバイル） | `settings/nav/back-to-chat.png`、`settings/nav/mobile-back-to-chat.png` | — |

- 「+」は見出しの右に置き、チャンネルと DM で同じ形にした。ルームが 0 件のときは一覧ごと出ないので、`chat/room/empty-rooms.png` の「チャンネルを作成」はそのまま残す。
- 「チャットに戻る」は、管理画面と設定の左のナビの上（デスクトップ）と、設定の一覧のヘッダー（モバイル）に置いた。管理画面のモバイルは、これまでどおりヘッダーの「戻る」がチャットに戻る。
- メンバーを追加する画面は、DM の相手を選ぶ画面（`chat/room/dm-dialog.png`）と同じ形にし、すでにチャンネルにいる人を候補から外す。
- **既存のスクリーンショット（Claude Design 由来）には、これらの「+」「設定」「チャットに戻る」がまだ写っていない。** Claude Design 側を直したら撮り直す。
### Phase 6.4 で足した画面

参加・退出・作成・名前の変更のログ（ADR 0033）は Phase 6 のデザインになかったので、既存の部品とトークンのまま足した。
実装を headless Chrome で撮ったもの。

| 画面 | スクリーンショット | 関連する API |
|---|---|---|
| 参加・名前の変更のログを挟んだタイムライン | `chat/timeline/system-messages.png` | `message.created`（`kind: "system"`） |

- ログは人の発言ではないので、アバターも名前も出さず、日付の区切りと同じ中央寄せの控えめな 1 行にする。続けて表示（grouped）の基準にもしない。
- 文言は「{主語} が〜しました」。サーバーは種類とそのときの名前だけを返し、文言はクライアントが作る。
- サイドバーの最後の 1 行にも、同じ文言をそのまま出す（送信者の名前は前に付けない）。

### チャンネルの退出で足した画面

チャンネルを自分で退出する入口がなかった（API はあった）ので、既存の部品とトークンのまま足した（ADR 0034）。
実装を headless Chrome で撮ったもの。

| 画面 | スクリーンショット | 関連する API |
|---|---|---|
| チャンネルの設定のいちばん下の「チャンネルを退出」（読み取り専用の member の例） | `chat/room/room-settings-leave.png` | — |
| 退出の確認（公開 / 非公開） | `chat/room/dialog-leave-room.png`、`chat/room/dialog-leave-room-private.png` | `DELETE /rooms/{id}/members/{自分}` |

- 形はワークスペースの退出（`workspace/settings/settings-as-member.png`、`workspace/settings/dialog-leave.png`）に合わせた。
- 参加していれば、ロールに関係なく出す。参加していない public と DM には出さない。
- 説明は公開範囲で分ける。公開は退出したあとも読める、非公開は読めなくなる。
- 退出したあとは、公開ならその場で「参加する」の状態に戻り、非公開なら「外されました」を出さずにワークスペースの入口に戻る。
- `chat/room/room-settings-dialog.png`（Claude Design 由来）にはこの欄がまだ写っていない。

### 非公開チャンネルから外されたときの画面を変えた

オーナーの判断（2026-09-19、Slack に合わせる）で、Claude Design の `chat/room/removed-from-channel.png`
（ヘッダーとサイドバーに名前を残し、「このチャンネルから外されました」と「『{名前}』のメンバーではなくなった」を出す）を置き換えた（ADR 0035）。
**このスクリーンショットは、実装を headless Chrome で撮り直したもの**。Claude Design 側も合わせて直す。

- 見出しは「このチャンネルにはアクセスできません」、説明は「チャンネルが存在しないか、閲覧する権限がありません。」。操作は「チャンネル一覧に戻る」のまま。
- チャンネルの名前はどこにも出さない。ヘッダー（名前・人数・設定・メンバー）ごと出さず、サイドバーからもすぐに消し、メンバーのパネルも閉じる。
- 「外された」とは言わない。読めなくなった人には、存在しないチャンネルと区別できない形にする。
- URL で読めないチャンネル（存在しない、非公開のメンバーではない）を開いたときも同じ画面にする（これまでは黙ってワークスペースの入口に戻していた）。
- タイムラインのシステムメッセージ「{名前} がチャンネルから外されました」（ADR 0033）は、残ったメンバーが見るものなので変えない。

### Phase 6.5 で足した画面（スレッド）

スレッド（ADR 0036）は Phase 6 のデザインになかったので、既存の部品とトークンのまま足した（オーナーと確認）。
実装を headless Chrome で撮ったもの。

| 画面 | スクリーンショット | 関連する API |
|---|---|---|
| スレッドのパネル（親・返信・入力中・入力欄）と、チャンネルの「N 件の返信」 | `chat/thread/thread-panel.png` | `GET /rooms/{id}/threads/{rootID}/messages`、`POST /rooms/{id}/messages`（thread_root_id） |
| 返信が 0 件のパネル（「返信」から開いた直後） | `chat/thread/thread-panel-empty.png` | — |
| 親が削除されたスレッド | `chat/thread/thread-root-deleted.png` | — |
| サイドバーの「スレッド」と、参加しているスレッドの一覧 | `chat/thread/threads.png` | `GET /workspaces/{id}/threads` |
| 参加しているスレッドが 0 件 | `chat/thread/threads-empty.png` | — |
| スレッド・スレッドの一覧（モバイル） | `chat/thread/mobile-thread.png`、`chat/thread/mobile-threads.png` | — |

- **パネル**: デスクトップはメンバーのパネルと同じ右のパネル（幅 384px）。モバイルはシートではなく全画面で重ねる（返信を読みながら入力するには高さが足りない）。
  見出しは「スレッド」とルームの名前。親の下に「N 件の返信」の区切り、その下に返信。
- **「N 件の返信」**: 親のメッセージの下に、返信の数と最後の返信の時刻を出す。押せるので緑（`--color-primary`）。
  パネルで開いている親は、選択中のチャンネルと同じ `--color-primary-subtle` の背景にする。
- **入れ子にしない**: パネルの中（親と返信）には「返信」のホバー操作を出さない。編集・削除の「…」は残す。
- **入力欄**: チャンネルと同じ部品で、案内と読み上げの名前を「スレッドに返信」にする（同じ画面に 2 つ並ぶため）。入力中の表示はそのスレッドで入力している人だけ。
- **削除された親**: tombstone のまま、「N 件の返信」とスレッドは残す。
- **サイドバーの「スレッド」**: ルームの一覧の上。バッジは未読のある **スレッドの数**（返信の数ではない）で、チャンネルと同じ琥珀。
  スレッドの返信はチャンネルの未読に数えないので、返信に気づく場所はここになる。
- **スレッドの一覧**: ルームの代わりにメインの領域に出す。1 行に ルーム・親の冒頭（2 行まで）・返信の数・最後の返信・未読。
  スレッドの中身は展開せず、押すとそのルームのパネルを開く（読む場所と書く場所をパネルの 1 つにそろえる）。
- **引用付きの返信は消した**: `chat/composer-reply.png`（Phase 6-1 で足した画面）は、API から `reply_to` を消したとき（Phase 6.5 の構築順 3）に削除した。
  Claude Design 由来の `chat/timeline/messages-all-states.png` などには引用の行がまだ写っているが、実装にはない。Claude Design 側を直したら撮り直す。
  メッセージのホバーの「返信」は、同じアイコンのままスレッドを開く操作にした（構築順 5。ADR 0037）。
- 実装で決めたこと（ADR 0037）: スレッドは `?t=` の URL で開く（Phase 6.11b で `?thread=` から改名。ADR 0042 決定 6）。検索している間はサイドバーの「スレッド」を出さない。
  返信が全部削除された親には「N 件の返信」を出さない。パネルの取得中はヘッダーだけ。

### Phase 6.6 で足した画面（チャンネルにも投稿する）

ADR 0039 の「チャンネルにも投稿する」を、既存の部品とトークンのまま足した。撮り方は Phase 6.5 と同じ。

| 画面 | スクリーンショット | 関連する API |
|---|---|---|
| チェックを付けた入力欄、スレッドの注記、チャンネルの「スレッドに返信しました」 | `chat/thread/thread-broadcast.png` | `POST /rooms/{id}/messages`（thread_root_id、also_in_channel） |
| スレッドのチェックボックス（モバイル） | `chat/thread/mobile-thread-broadcast.png` | — |
| チャンネルに流した返信（モバイル） | `chat/thread/mobile-room-broadcast.png` | — |

- **チェックボックス**: スレッドの入力欄の下、「Enter で送信」の左。文言は「チャンネルにも投稿する」（DM では「DM にも投稿する」）。
  ブラウザの標準の checkbox に `accent-color` で `--color-primary` を当てる。角の小さい四角を描くには角丸のトークン（8px 以上しかない）が合わないため、新しいトークンを作らずにこうした。
  返信できない人（参加していない public）には入力欄ごと出さないので、チェックボックスも出ない。
  スレッドの既存の画面（`chat/thread/thread-panel.png` など 4 枚）も、チェックの付いていない状態で撮り直した。
- **チャンネルの行**: 名前と時刻の下に「スレッドに返信しました」を出す。押すとスレッドを開くので緑。親の本文の抜粋は出さない（ADR 0039）。
  直前が同じ人の発言でも続けて表示（アバターと名前の省略）にしない。スレッドから来た行だと分かるようにするため。
- **スレッドの行**: 本文の下に「チャンネルにも投稿しました」（DM では「DM にも投稿しました」）を控えめに添える。押せない。

### Phase 6.13 で足した画面（メンション）

ADR 0043 のメンションを、既存の部品とトークンのまま足した（新しいトークンは要らなかった）。

| 画面 | スクリーンショット | 関連する API |
|---|---|---|
| 自分宛て・`@channel`・`@here` のある本文と、サイドバーの `@2` | `chat/mention/mentions.png` | `GET /rooms`（mention_count）、メッセージの `mentions` |
| 同（ダーク） | `chat/mention/mentions-dark.png` | — |
| `@` を打った直後の補完 | `chat/mention/mention-completion.png` | `GET /rooms/{id}/members` |
| 名前で絞った補完 | `chat/mention/mention-completion-typed.png` | — |
| `@channel` を送る前の確認 | `chat/mention/mention-all-confirm.png` | — |
| 自分宛てのある画面（モバイル） | `chat/mention/mobile-mentions.png` | — |
| `@` の補完（モバイル） | `chat/mention/mobile-mention-completion.png` | — |

- **本文のチップ**: 個人は `@表示名` で、`--color-primary-subtle` の上に `--color-primary`。Phase 6.9 でプロフィールのカードを開くので押せる（リンクと同じ緑）。
  `@channel` / `@here` はルームの全員に飛ぶので個人より目立たせ、`--color-attention` の上に `--color-on-attention` で塗る。押せない。
  自分宛ての行の背景も琥珀なので、薄い琥珀では埋もれる。ダークの `--color-attention` は黄色寄りになる。
- **自分宛ての行**: 背景を `--color-attention-subtle` にし、左端に 2px の `--color-attention` の縦線を引く（送信失敗の赤い線と同じ位置）。
  既読になっても消さない。行そのものは押す要素ではないので、琥珀でよい。続けて表示している同じ人の次の発言は、メンションがなければ琥珀にしない。
- **サイドバー**: 数字のバッジは「知らせが要るもの」だけに出す。チャンネルは自分宛ての数を `@2`、DM は未読の数をそのまま。
  ただ読んでいないだけのチャンネルにはバッジを出さず、名前を太字にする。
- **補完**: 入力欄の上に重ねる。幅 288px、上限 8 件。個人が先、`@channel` / `@here` は前方一致したときだけ後ろに出す。
  キャレットの位置には付けない（`textarea` では文字の座標を測れない）。
- **送る前の確認**: `@channel` / `@here` のときだけ出す。人数を文言に入れる。ボタンは「キャンセル」と「送信する」（primary。消す操作ではないので danger にしない）。

#### 撮り直しが要るもの ← Phase 6.7.6 で済んだ

サイドバーのバッジの出し方を変えた（未読のチャンネルのバッジが消えて名前が太字になった）ので、
**サイドバーの写っているスクリーンショットが全部古く**なっていた。
またこの 7 枚は Linux の Chromium で撮っていた（`tools/shoot-ui.mjs` が既定にしている macOS の Chrome ではない）。

Storybook への移行（Phase 6.7.6、ADR 0047）で `make web-shots` を全部に通したので、
どちらも解消した（実装から撮っている PNG は、いまはすべてオーナーの手元の macOS の Chrome で撮ったもの）。

### Phase 6.11 で足した画面（メッセージへのリンクと、指定したメッセージへ飛ぶ）

ADR 0040（リンクとカード）と ADR 0042（飛ぶ）の見た目を、既存の部品とトークンのまま足した（新しいトークンは要らなかった）。
ADR 0042 の決定 7 のとおり、**飛ぶ側（6.11b）の実装はこの画面が入ってから**にする。

| 画面 | スクリーンショット | 関連する API |
|---|---|---|
| 本文に貼られたリンクのカード（読めるもの・表示できないもの） | `chat/link/message-link-card.png` | `POST /messages/links` |
| 未読が読み込んだページより古いときのバー | `chat/link/unread-jump-bar.png` | `GET /rooms/{id}/messages?after_seq=` |
| リンクやカードから飛んできた先の強調 | `chat/link/jump-highlight.png` | `GET /rooms/{id}/messages?around_message_id=` |
| リンク先のメッセージが見つからない | `chat/link/message-not-found.png` | 同上（`around: null`） |
| 未読へ飛ぶバー（モバイル） | `chat/link/mobile-unread-jump-bar.png` | — |
| 飛んできた先の強調（モバイル） | `chat/link/mobile-jump-highlight.png` | — |

- **カード**（6.11a。実装済み）: 本文の下に、貼られた順に最大 3 件。ルーム名（別のワークスペースならワークスペース名も）・送信者・時刻・本文を出す。
  左の縦線は引用の印で、押せる要素ではないので緑にしない。長い本文はカードの中だけ畳み、「すべて表示する」で広げて「折りたたむ」も残す。
  読めない・存在しない・削除済みは区別せず、どれも「このメッセージは表示できません」の 1 行にする（ADR 0040）。
  この画面は実装のあとから足した（実装が先になってしまった 1 件）。
- **未読のバー**: ヘッダーと接続状態のバナーの下、タイムラインの上端に置く。高さはバナーと同じ 36px。
  件数は「いま起きていること」なので琥珀（`--color-attention-subtle` の地に `--color-attention-text`）、「最初の未読へ」は押せる操作なので緑。
  **未読が最初のページの中にあるときは出さない**（「ここから未読」の線が見えているので、押しても何も起きないボタンになる。ADR 0042）。
  そのため、この画面には線を出していない。
- **飛んできた先の強調**: その行の地を `--color-attention-subtle` にする。数秒で消え、押しても消える（消すのはデータ層）。
  スレッドを開いている親（`--color-primary-subtle`）や自分宛て（琥珀）より優先する。どれに飛んだかが先に要るため。
  続けて表示している次の行までは塗らない。パーマリンクが指すのは 1 件のメッセージなので、その行だけを示す。
- **見つからなかったとき**: 同じ位置に、`--color-surface-muted` の地で 1 行だけ出す。理由は書かない（ない・読めない・削除済みを区別しない。ADR 0040 と同じ方針）。
  読み続けている間ずっと残ると邪魔なので、右端の × で閉じられるようにした。**閉じられるようにするかはデザインで決めた点**なので、オーナーに確認する。

### Phase 6.7 で足した画面（絵文字のリアクション）

ADR 0044 のリアクションを、既存の部品とトークンのまま足した（新しいトークンは要らなかった）。

| 画面 | スクリーンショット | 関連する API |
|---|---|---|
| リアクションの行と、ホバーの操作に足した「＋」 | `chat/reaction/reactions.png` | メッセージの `reactions` |
| 同（ダーク） | `chat/reaction/reactions-dark.png` | — |
| チップにホバーして「誰が付けたか」 | `chat/reaction/reaction-names.png` | 同上（`users` は先頭 8 人） |
| 絵文字のピッカー | `chat/reaction/reaction-picker.png` | `PUT /rooms/{id}/messages/{id}/reactions/{emoji}` |
| 同（ダーク） | `chat/reaction/reaction-picker-dark.png` | — |
| ピッカーが上に開く（いちばん下のメッセージ） | `chat/reaction/reaction-picker-above.png` | — |
| リアクションの行（モバイル） | `chat/reaction/mobile-reactions.png` | — |
| ピッカー（モバイル） | `chat/reaction/mobile-reaction-picker.png` | — |

- **チップ**: 高さ 28px の `rounded-full`。絵文字 + 数（等幅）。並びは最初に付いた順のままで、数では並べ替えない（ADR 0044 決定 3）。
  **自分が付けているものは緑**（`--color-primary-subtle` の地に `--color-primary` の枠と文字）。押すと外れる操作なので、
  「緑 = 操作できるもの」にそのまま当てはまる。未読や入力中と違って「いま起きていること」ではないので、琥珀は使わない。
  付けていないものは `--color-surface` の地に `--color-border` の枠で、ホバーで枠だけ濃くする。
- **行の位置**: 本文・添付・リンクのカードの下、「N 件の返信」より上。1 件も付いていなければ行ごと出さない。
- **「＋」**: リアクションの行の末尾に、同じ大きさのチップとして常に置く。まだ 1 件も付いていないメッセージには、
  ホバーの操作の「＋」から開く（返信より左）。投稿できない人（参加していない public ルーム）には、どちらも出さない。
- **誰が付けたか**: チップにホバーすると、上に「A、B 他 N 人が 👍 を付けました」を出す。
  API が返す名前は先頭 8 人までなので、足りないぶんは人数でまとめる（ADR 0044 決定 3）。
  吹き出しは `--color-surface` の地に枠と影（ポップオーバーと同じ）。読み上げには同じ文言をボタンの名前で渡してあるので、吹き出し自体は読ませない。
- **ピッカー**: emoji-mart（ADR 0044 決定 7）。色は `globals.css` の `--color-*` を読んで `--em-*` に写しているので、
  ライトでもダークでも周りと同じ地になる。角丸と余白はライブラリのままで、そこまでは追わない。
  日本語のロケールを渡し、プレビュー（選んだ絵文字の大きな表示）は出さない。
- **ピッカーの置き場所**: メッセージの行の右上から**下**に開き、下に入りきらなければ**上**に開く。
  入力欄より上に出す（絵文字を選んでいる間は入力しないので、隠れても困らない）。
  画面に浮かせる（`fixed`）ので、タイムラインの高さは変わらない。

#### デザインで決めた点（オーナーに確認する）

- **モバイルのピッカーは、ポップオーバーではなく下から出るシートにした。** ピッカーは 400px 近く高いので、
  メッセージに吊るすとタイムラインからはみ出して上が切れる（実際に切れた）。メンバーのシートと同じ形にそろえ、
  背景を覆って外を押すと閉じるようにした。md 以上はメッセージの行に合わせて画面に浮かせる。
- **md 以上のピッカーは、下に入りきらなければ上に開く**（オーナーの指摘、2026-09-20）。
  はじめはタイムラインの中に `absolute` で置いていたが、いちばん下のメッセージで開くと
  スクロールできる範囲がピッカーのぶん広がって下に余白ができ、入力欄の上にも出られなかった。
  画面に浮かせる（`fixed`）形に変え、上下は入るかどうかで決める。
- **ホバーの操作は「＋」→「返信」→「…」の並びにした**（Slack と同じ並び）。
- **「＋」を行末に常に出す**（ホバーのときだけ出すのではなく）。付いているリアクションに続けてもう 1 つ足すのが、いちばん多い操作になるため。

### Phase 6.7.5 で足した画面（添付ファイルの拡大表示と削除）

ADR 0045 のとおり、既存の部品とトークンのまま足した（新しいトークンは要らなかった）。

| 画面 | スクリーンショット | 関連する API |
|---|---|---|
| 画像の拡大表示（同じメッセージの 3 枚を送る） | `chat/attachment/image-viewer.png` | 既存の GET URL（ADR 0028） |
| 同（ダーク） | `chat/attachment/image-viewer-dark.png` | — |
| 最後の画像（送れる向きにだけ矢印を出す） | `chat/attachment/image-viewer-last.png` | — |
| 1 枚だけの画像（送る導線を出さない・消せない人） | `chat/attachment/image-viewer-single.png` | — |
| 画像でない添付の行の「…」 | `chat/attachment/attachment-menu.png` | — |
| 添付だけの削除の確認 | `chat/attachment/attachment-delete-dialog.png` | `DELETE /rooms/{id}/messages/{id}/attachments/{id}` |
| 最後の 1 枚で、メッセージごと消えるときの確認 | `chat/attachment/attachment-delete-dialog-last.png` | 同上（応答は tombstone。ADR 0045 決定 8） |
| 拡大表示（モバイル） | `chat/attachment/mobile-image-viewer.png` | — |

- **開けるのは画像だけ**: インラインで出している画像（PNG / JPEG / GIF / WebP。ADR 0028）を押すと開く。
  まだ GET URL の取れていない送信中の添付は押せない。画像でない添付はこれまでどおり、押すとダウンロードが始まる。
- **ヘッダー**: ファイル名と「2 / 3」（等幅）、右にダウンロード・削除・閉じる。削除は消せる人のときだけ出す（ADR 0045 決定 9）。
- **送る**: 左右の矢印ボタンと `←` `→`。**端では矢印を出さない**（巻き戻さない。押せないボタンを残すと、押せるものと見分けがつかない。オーナーの指摘、2026-09-20）。
  1 枚しかなければ、矢印も枚数も出さない。どこまで来たかは「3 / 3」の数で分かる。キーは画面ぜんぶで受けるので、矢印が消えても操作は止まらない。
- **画像**: 原寸をそのまま `object-contain` で収める（拡大用の別サイズは作らない。ADR 0045 決定 4）。
  縦長の画像は左右に地（`--color-surface-muted`）が出る。
- **閉じる**: `Esc`・背景・×。開いている間はフォーカスを中に閉じ込め、閉じたら元の画像に戻す。

#### デザインで決めた点（オーナーに確認する）

- **md 以上では全画面にせず、大きなダイアログ（960×640）として浮かせた。** 後ろのチャットが残るので、
  どのメッセージの画像を見ているかが分かる。地は `--color-surface`、画像の面は `--color-surface-muted` で、
  ほかのダイアログと同じ語彙のまま。ライトでもダークでも周りと同じ地になる（黒い額縁は作らなかった）。
  モバイルは ADR どおり全画面。
- **1 つのメッセージに画像が複数あるときは、横に並べて折り返すことにした。** これまでは添付を縦に積んでいて、
  3 枚付けるとタイムラインが 1 画面ぶん流れてしまう。1 枚だけのときの見た目は変わらない（既存の画面は撮り直しても差が出ない）。
  画像でない添付の行は、これまでどおり 1 行を使う。
- **削除の確認は、拡大表示の上に重ねて出す。** 拡大表示を `z-40`、ダイアログを `z-50` にしてある
  （拡大表示は body の直下に出すので、明示しないと順番で前に出てしまう）。
- **画像の削除の導線は拡大表示の中だけ**にした（ADR 0045 決定 9）。タイムラインの小さい画像に「…」を足すと、
  ホバーの操作（＋ / 返信 / …）と重なって押し間違える。
- **モックの画像を `web/public/dev/photo-*.png` に足した**（拡大表示は中身がないと見比べられないため）。

### Phase 6.8 で足した画面（離席とカスタムステータス）

ADR 0049 のとおり、既存の部品とトークンのまま足した（新しいトークンは要らなかった）。

| 画面 | スクリーンショット | 関連する API |
|---|---|---|
| 3 つの presence が並ぶメンバーパネル | `chat/presence/away-dots.png` | メンバーの `presence` / `away` |
| 同（ダーク） | `chat/presence/away-dots-dark.png` | — |
| 名前の横とサイドバーの DM のステータス | `chat/presence/status-in-timeline.png` | メンバーの `status` |
| アカウントメニュー（ステータスと離席） | `chat/presence/account-menu-status.png` | `PUT /users/me/presence` |
| ステータスを設定（未設定） | `chat/presence/status-dialog-empty.png` | `PUT /workspaces/{id}/me/status` |
| ステータスを設定（設定済み） | `chat/presence/status-dialog-filled.png` | 同上（解除は `DELETE`） |
| 同（ダーク） | `chat/presence/status-dialog-dark.png` | — |
| ステータスの絵文字のピッカー | `chat/presence/status-dialog-picker.png` | — |
| ステータスを設定（日時を選択） | `chat/presence/status-dialog-custom.png` | 同上（`expires_at` は絶対の時刻） |
| ステータスを設定（カレンダー） | `chat/presence/status-dialog-calendar.png` | — |
| ステータスを設定（時刻の候補） | `chat/presence/status-dialog-time.png` | — |
| ステータスを設定（モバイル） | `chat/presence/mobile-status-dialog.png` | — |
| メンバーのシート（モバイル） | `chat/presence/mobile-away-dots.png` | — |

- **ドットは 3 つ**: オンラインは今までどおり `--color-online` の緑、**離席は色を持たないアウトライン**
  （`--color-text-muted` の枠と `--color-surface` の中身）、オフラインはドットを出さない。
  離席に琥珀を使わないのは、琥珀が「いま起きていること」（未読・入力中）の色だから（CLAUDE.md「デザイン」）。
  最終オンライン時刻は引き続き出さない。
- **ステータスは、名前の横には絵文字だけ**を出す。文言まで出すと、名前の行の長さが人によってばらばらになる。
  文言はホバー（`title`）と読み上げで読め、メンバーパネルではロールの横（`管理者 · 集中しています`）にそのまま出す。
  絵文字は**名前のすぐ横**（4px）に置く。サイドバーの DM では、名前と絵文字を 1 つのまとまりにして、時刻だけを右端に寄せる
  （同じ並びに入れると、名前から離れて時刻の隣まで飛ぶ。オーナーの指摘、2026-09-21）。
- **入口はアカウントメニュー**（サイドバーの自分のアバター）。「ステータスを設定」と「離席中にする / 離席を解除する」の 2 つ。
  設定済みのときは、メニューにいまのステータスがそのまま並び、押すと変えられる（Slack と同じ）。
  自動の離席（別のタブを見ている・10 分操作がない）はここに出さない。**自分で戻せるものだけを操作にする**。
- **設定のダイアログ**: 絵文字のボタン + 文言（100 文字まで。残りの数を下に出す）+ よく使うもの 5 つ +
  「次の時間の経過後に削除」7 つ（削除しない / 30 分 / 1 時間 / 4 時間 / 今日 / 今週 / 日時を選択。見出しも選択肢も Slack の文言）。
  **ラベルと中身の余白は、どの節も入力欄と同じ 6px にそろえる**（節ごとに書いていたら距離がばらついた。オーナーの指摘、2026-09-21）。
  **絵文字のボタンは入力欄と同じ行に入れる**（`TextField` の `leading`）。ラベルと補足（残りの数）の外に置くと、
  補足のぶんボタンが下にずれる（オーナーの指摘、2026-09-21）。
  絵文字は 6.7 のピッカーをそのまま使い、**md 以上はボタンに合わせて浮かせ、モバイルは下から出るシート**にする
  （ダイアログの中に流し込むと、ピッカーのぶんでダイアログが画面からはみ出した）。
  浮かせる位置は、ボタンのような狭いアンカー用に**左そろえ**を足した（`lib/anchored-position.ts` の `align`）。

#### デザインで決めた点（オーナーに確認する）

- **期限は 7 つの丸いラジオ**（招待リンクの有効期限と同じ部品）。「今日」「今週」のような相対の期限は、
  押した時点でクライアントが絶対の時刻にして送る（ADR 0049 決定 5）。
  **「日時を選択」を選ぶと、日付と時刻のボタンが下に出る**。押すと**自前のカレンダー**と 30 分刻みの時刻の一覧が開く。
  ブラウザ標準の `<input type="date" / "time">` は使わない（見た目がブラウザと OS のもので、トークンに従わないため）。
  カレンダーは `components/ui/calendar.tsx`。ピン留めの期限（6.12）や検索の期間（6.16）でも使い回す。
  **時刻は「候補の一覧 + 自由入力」**（Slack のデスクトップと同じ）。候補は 30 分ごとで、打った文字で絞る（`17` → 17:00 / 17:30）。
  候補に無い時刻（17:05）も打てる。モバイルは OS 標準の時刻入力にする（これも Slack と同じ）。
  開いたときは、選んでいる時刻が見える位置から出す。
- **いつ消えるかは、ステータスのホバーで見せる**（「休憩中 · 今日 17:00 まで」）。Slack と同じ。
  メンバーパネルでは、ロールと文言の横にそのまま出す。
- **よく使うものは 5 つ**（会議中 / 移動中 / 食事中 / 集中しています / 休暇中）。押すと絵文字と文言がそのまま入る。
- **文言だけを書いたときの絵文字は `💬`**（サーバーは絵文字を必須にしているので、クライアントが入れる）。
- **自分のアバター（サイドバーの右上）には presence のドットを出していない。** 自分の状態はアカウントメニューで分かる。

### Phase 6.9 で足した画面（プロフィール）

ADR 0050 のとおり、既存の部品とトークンのまま足した（新しいトークンは要らなかった。パネルの幅はスレッドの `--pane-thread` を共有する）。
**md 以上はアバターか名前に乗せるとカード、押すと右のパネル。モバイルは押すと全画面のパネル**（Slack と同じ。オーナーの指摘、2026-09-21）。

| 画面 | スクリーンショット | 関連する API |
|---|---|---|
| ホバーのカード（他人） | `chat/profile/hover-other.png` | メンバー一覧の 1 行（API は呼ばない） |
| ホバーのカード（自分） | `chat/profile/hover-self.png` | — |
| ホバーのカード（外された人） | `chat/profile/hover-former.png` | —（メッセージの送信者の値だけ） |
| ホバーのカード（ダーク） | `chat/profile/hover-other-dark.png` | — |
| パネル（他人） | `chat/profile/panel-other.png` | `GET /workspaces/{id}/members/{userID}` の `email` |
| パネル（3 点メニュー） | `chat/profile/panel-menu.png` | — |
| 同（ダーク） | `chat/profile/panel-menu-dark.png` | — |
| パネル（操作できる相手のメニュー） | `chat/profile/panel-manage.png` | `PATCH` / `DELETE /workspaces/{id}/members/{userID}` |
| パネル（自分） | `chat/profile/panel-self.png` | — |
| パネル（email の読み込み中） | `chat/profile/panel-email-loading.png` | `GET /workspaces/{id}/members/{userID}` |
| パネル（email が未検証） | `chat/profile/panel-email-unverified.png` | 同上（`email: null`） |
| パネル（外された人） | `chat/profile/panel-former.png` | —（メッセージの送信者の値だけ） |
| パネル（開き直して見つからない） | `chat/profile/panel-unknown.png` | 同上（404） |
| パネル（メンバーから開いた） | `chat/profile/panel-from-members.png` | — |
| パネル（モバイル） | `chat/profile/mobile-panel.png` | — |

- **ホバーのカード**: 乗せて 500ms で開き、アバターや名前からカードへ移る間（200ms）は閉じない。乗せた方の横に出す
  （行には重ねない。右に入らなければ左。`lib/anchored-position.ts` の `placeBeside`）。中身は要約と「DM を送る」だけで、
  email は出さない（ホバーでは API を呼ばない）。自分と外された人には操作を置かない。タッチとキーボードでは出さない。
- **パネル**: スレッドと同じ右の枠（URL は `?p=`）。モバイルはスレッドと同じ全画面で、左上の「戻る」で閉じる。
  メンバーパネルの行から開いたときだけ、左上に「メンバーに戻る」を出す。
  上から、写真・名前と handle とロールと presence・ステータス・操作の行（「DM を送る」/ 自分は「プロフィールを編集」と「…」）・連絡先（email）。
  **写真は角丸（`rounded-lg`）の正方形で、パネルの幅いっぱい**（上限 352px。パネルの高さの 1/3〜1/2 ほど。Slack と同じ。オーナーの指摘、2026-09-21）。
  ホバーのカードとタイムラインは今までどおり丸。写真の隅には presence のドットを重ねず、ロールの横の文言の前に置く。
  画像のない人の頭文字は、段階の外の `text-avatar`（112px）で出す（26px では正方形の中で小さすぎた。オーナーの確認、2026-09-21）。
  「…」にコピーの 2 つと、操作できる相手のときだけロールの変更と削除。ロールの並びと削除の見た目は管理画面のメニュー
  （`workspace/member-list`）と同じにした。
- **email は応答を待つ間、行の高さを取って薄い帯を出す**。未検証なら連絡先の節もコピーも出さない（ADR 0050 決定 2）。
- **presence の文言（「オンライン」「離席中」）をロールの横に出す**。オフラインは文言もドットも出さない（最終オンライン時刻は出さない）。

#### デザインで決めた点（オーナーに確認する）

- **キックの文言は「ワークスペースから削除」**にした。ロードマップの確定事項では「ワークスペースから外す」と書いたが、
  管理画面の同じ操作が「ワークスペースから削除」で、確認のダイアログ（`KickMemberDialog`）も共通なので、そろえた。
- **外された人のパネルは、メニューを出さずに「ハンドルをコピー」のボタンを 1 つだけ**置いた（操作が 1 つなら、メニューに隠すより直接押せる方がよい）。
- **presence の文言を出した**のは、ドットだけだと大きいアバターでも離席のアウトラインが見分けにくいため。管理画面のメンバー一覧も文言を出している。
- **パネルの 3 点メニューは「…」の上（写真の側）に開く**。操作の行は大きな写真の下にあり、下に開くと画面の下で切れる。

### Phase 6.10a で足した画面（本文の書式）

ADR 0051 のとおり。新しいトークンはリストの記号の 2 つだけ（`docs/ui/tokens.md`）。本文は保存された記法のまま持ち、表示のときに解釈する。

| 画面 | スクリーンショット | 関連する API |
|---|---|---|
| 書式（太字・リスト・リンク・引用・コード） | `chat/format/formatting.png` | —（`body` をそのまま解釈する） |
| 同（ダーク） | `chat/format/formatting-dark.png` | — |
| 同（モバイル） | `chat/format/mobile-formatting.png` | — |

- **太字は `font-bold`、斜体・取り消しはそれぞれの要素**。日本語の斜体は書体に斜体がないので、ブラウザが傾けて描く。
- **インラインコードとコードブロックは `--font-mono`、地は `surface-muted`、線は `border`**。コードブロックは折り返さず、
  長い行は横にスクロールする（折り返すと字下げが崩れる）。角丸は `rounded-sm`。
- **引用は左に `border` の線（4px）を引き、文字を `text-secondary` にする**。既存の引用の見た目（削除の確認のダイアログ）より線を太くしたのは、
  本文の中で地の色なしに区切りを見せるため。
- **リストは記号と番号を出し、段ごとに字下げする**。箇条書きの記号は段ごとに `•` → `◦` → `▪`（Slack と同じ。
  2・3 段目のためにトークン `--list-style-type-circle` / `--list-style-type-square` を足した。オーナーの確認: 2026-09-21）。
  番号付きリストは書いた番号を出す。
- **リンクは `primary` の文字で、ホバーで下線**（押せるものは緑）。別のタブで開く。
  文字付きのリンク（`<URL|文字>`。ADR 0051 決定 4 の追記）は文字を出し、行き先の URL はホバー（`title`）で見せる。
- **下線は `underline`**（`__下線__`。ADR 0051 の下線の追記）。リンクのホバーの下線と同じ線だが、色は本文と同じなので見分けられる。
- 「（編集済み）」は最後の段落に続けて出す。最後がコードブロックやリストなら、その下に出す。
- HTML を書いても文字のまま出ることを、最後の行（`<script>`）で見せている。

#### デザインで決めた点（オーナーに確認する）

- **引用の線を 4px にした**（既存の引用とカードの線は 2px）。
- ~~リストの記号を段で変えない~~ → 段で変える（オーナーの指摘。任意値を使わずにトークンで書ける。2026-09-21）

### Phase 6.10b で足した画面（リッチテキストの入力欄）

ADR 0052 のとおり、入力欄を Lexical のリッチテキストにした。新しいトークンはインラインコードの文字の `--color-code-text` だけ（オーナーの確認: 2026-09-21）。
ほかに、下線と取り消し線を同じ文字に当てるユーティリティ `underline-strike` を `globals.css` に足した。
入力欄が変わったので、入力欄の写るアプリ由来の画面はすべて撮り直した。

| 画面 | スクリーンショット | 関連する API |
|---|---|---|
| 書式とメンションを入れた下書き | `chat/composer/formatted.png` | —（送る値は ADR 0051 の記法のテキスト） |
| 同（ダーク） | `chat/composer/formatted-dark.png` | — |
| 書式のツールバーを隠したところ | `chat/composer/toolbar-hidden.png` | — |
| リンクを入れる画面 | `chat/composer/link-dialog.png` | — |
| 同（モバイル） | `chat/composer/mobile-formatted.png` | — |
| `@` の補完（キャレットの上に出る） | `chat/mention/mention-completion*.png`（撮り直し） | — |

- **入力欄は Slack と同じ 3 段**: 上にツールバー、真ん中に入力、下に操作の行（左に添付と「Aa」、右端に送信）。オーナーが示した Slack の画面に合わせた（2026-09-21）。
- **ツールバーは入力欄の枠の中の上の行**。並びは Slack の書式のツールバーにリンクを加えたもの（太字・斜体・下線・取り消し線 ｜ リンク・コード ｜ 引用・コードブロック・番号付きリスト・箇条書き）。
  ボタンのラベルと `title` にショートカットを添える（Mac は ⌘、ほかは Ctrl）。効いている書式のボタンは `surface-muted` の地で押された状態にする。
- **ツールバーの表示・非表示は、下の段の下線付きの「Aa」**（Slack の書式設定アイコンと同じ文字。アイコンでは分かりにくいというオーナーの指摘で文字にした）。隠した状態はそのブラウザに覚える。隠しても記号の入力とショートカットは効く。
- **入力欄の中の書式は、本文の表示と同じトークン**（太字・下線・インラインコード・リンク・リスト）。メンションは本文と同じチップ（個人は緑、全員宛ては琥珀）。
- **送信はアイコンのボタン**（`primary` の地に紙飛行機。ラベルは「送信」）。送れる内容がなければ押せない。
- **インラインコードの文字は橙（`--color-code-text`）**。本文でも入力欄でも同じ。コードブロックと見分けやすくするため（Slack と同じ）。
- **`@` の補完は、全員宛てを先に、メガホンの印で出す**（個人は写真）。下に「↑↓ で移動 / ↵ で選択 / esc：キャンセル」を添える（Slack と同じ）。
- **`@` の補完はキャレットの上に出す**（textarea のときは入力欄の左上に固定だった。ADR 0043 → ADR 0052 決定 4）。上に入らなければ下。
- **リンクを入れる画面**は「テキスト」と「リンク」の 2 つの欄。テキストが空なら URL をそのまま出す。`< > \`` を含むテキストと、http / https でない URL では「保存」を押せない。
- **編集欄はツールバーを出さない**（記号の入力とショートカットで書式を付ける）。

#### デザインで決めた点（オーナーに確認する）

- **ツールバーを入力欄の枠の中に置き、常に出す（既定）**。モバイルでも同じ行を横にスクロールさせる。
- **添付は Slack の「＋」ではなく、今までのクリップのまま**にした（添付しかできないので、何が起きるかが分かるアイコンにした）。
- **編集欄ではツールバーを出さない**（編集欄は狭く、編集は短い直しが多いため）。

### Phase 6.10.5 で足した画面（email を検証するまで chat を使えない）

ADR 0053 のとおり、email を検証するまで chat の API と WebSocket を 403（`email-unverified`）で止める。止められたら、アプリの画面の代わりに確認待ちの画面を出す。

| 画面 | スクリーンショット | 関連する API |
|---|---|---|
| 確認待ち（チャットを使えない。ログアウトを足した） | `auth/verify/verify-pending-blocked.png` | `POST /auth/verify-email/request`・`POST /auth/logout` |

- **登録の直後と同じ画面**（`auth/verify/verify-pending.png`）に、**ログアウト**を「別のアドレスに変更する」と同じ補助のリンクの形で足した（ADR 0053 決定 3 の「再送とログアウト」）。
  確認するまで何もできないので、別のアカウントに移る道を残すため。登録の直後の画面にも同じく出す。
- **止めるかどうかはサーバーの応答だけで決める。** `user.email_verified` からは決めない（検証を外した開発環境では、未検証でも chat を使える）。
  403 `email-unverified` を受けたら 1 回だけ refresh して呼び直し、それでも止められたら確認待ちにする。
- **再送した確認メールのリンクには、いま開いている画面を戻り先として載せる。** 招待のリンク（`/j/{code}`）から来た人は、検証のあとに受け入れの画面へ戻る。
- **タブに戻ってきたら確かめ直す。** 別のタブや端末で検証を済ませていれば、そのままアプリの画面に進む。

#### デザインで決めた点（オーナーに確認する）

- ログアウトは、ボタンではなく補助のリンク（「別のアドレスに変更する」と同じ見た目）にした。主の操作は再送のまま。

### ボタンとメニューのアイコン（2026-09-21）

オーナーの要望（ボタンに文字が多いので、アイコンにできるものは替える。Slack のメッセージのメニューとボタンを参考に）。

- **メニューの行は「アイコン + 文字」**（`components/ui/menu-item.tsx` の `MenuItem`。Slack のメニューと同じ）。メッセージ（リンクをコピー・編集・削除）、
  ファイル（削除）、プロフィール（ハンドル・メールアドレスをコピー、ワークスペースから削除）、アカウント（ワークスペース設定・設定・ログアウト）。
  アイコンは読み上げず、名前は文字のまま。アイコンのない行（ロールの変更）も同じ幅の場所を取って、文字の頭をそろえる。
- **ファイルの行の「ダウンロード」はアイコンのボタン**（拡大表示の中と同じアイコン）。名前は読み上げと `title` に残す。
- **アップロードに失敗した添付の「再試行」「取り消し」もアイコン**（アップロード中・済みの取り消しはもとから ×）。
- **文字のまま残したもの**: ダイアログの「キャンセル」「保存」などの確定の操作、送信に失敗したメッセージの「再送する」「削除」（状態の知らせと一緒に読むもの）、
  「すべて既読にする」「すべて表示する」のような、アイコンにすると意味が伝わりにくいもの。
- Slack のメニューの右にあるショートカットの表示は、hibari にメッセージのショートカットがないので出さない。

### メニューとピッカーの閉じ方（2026-09-21）

**浮かせたパネル（メニュー・ピッカー）は、外を押す・Esc で閉じる。** アプリで共通の振る舞い（オーナーの要望）。
`Popover` は `onDismiss` を、`AnchoredPanel` はもとから同じ振る舞いを持ち、どちらも `lib/use-dismiss.ts` を使う。

- 押し下げで閉じる（押したまま外へ動かしても閉じる）
- **開くボタンには `aria-expanded` を付ける**。開いているボタンを押したときはボタン自身が閉じる（外として閉じてから、ボタンの処理で開き直さないため）
- 開いたまま別のメッセージの「…」を押すと、1 回でそちらのメニューに移る

### 削除したメッセージを出さないことにした

オーナーの判断（2026-09-19、Slack に合わせる）で、削除したメッセージの跡（「このメッセージは削除されました」）をタイムラインに出さないことにした（ADR 0038）。

- チャンネルでもスレッドの返信でも、削除したメッセージは並べない。
- 例外は、返信の残っているスレッドの親。返信の入口として跡を残す（`chat/thread/thread-root-deleted.png` のまま）。
- サイドバーの最後の 1 行は、削除されていない最後のメッセージにする。
- `chat/timeline/messages-all-states.png` / `chat/timeline/messages-all-states-dark.png`（Claude Design 由来）には削除済みの行が写っているが、実装では出さない。Claude Design 側を直したら撮り直す。

### 画面はあるが API がなかったもの（Phase 6 で追加した）

| 画面 | 追加した API |
|---|---|
| `settings/devices/devices.png`（ログイン中のデバイスの一覧・個別のログアウト・他のすべてのログアウト） | セッションの一覧と失効（ADR 0019） |
| `settings/profile/profile.png`（表示名・ハンドルの変更） | プロフィールの更新（ADR 0019） |
| `settings/profile-avatar*.png`（画像の変更・削除） | アバター画像のアップロードと配布（ADR 0020） |

### Phase 6.12 で足した画面（ピン留めと「後で」）

ADR 0054 のとおり、既存の部品とトークンのまま足した（新しいトークンは要らなかった。ピン留めのパネルの幅はスレッドの `--pane-thread` を共有する）。
タブの部品（`components/ui/tabs.tsx`）だけは新しく作った（それまでタブのある画面がなかった）。

| 画面 | スクリーンショット | 関連する API |
|---|---|---|
| ピン留めしたメッセージとチャンネルのログ | `chat/pin/timeline.png` | メッセージの `pinned`、システムメッセージの `message_pinned` |
| 同（ダーク） | `chat/pin/timeline-dark.png` | — |
| 同（モバイル） | `chat/pin/mobile-timeline.png` | — |
| 「…」の「チャンネルへピン留めする」 | `chat/pin/menu.png` | `PUT /rooms/{id}/messages/{messageID}/pin` |
| 「…」の「チャンネルからピンを外す」 | `chat/pin/menu-pinned.png` | `DELETE /rooms/{id}/messages/{messageID}/pin` |
| ピン留めの一覧 | `chat/pin/panel.png` | `GET /rooms/{id}/pins` |
| 同（ダーク） | `chat/pin/panel-dark.png` | — |
| 同（まだない） | `chat/pin/panel-empty.png` | 同上（空） |
| 同（モバイル） | `chat/pin/mobile-panel.png` | — |
| メッセージのホバーの「後で」 | `chat/saved/hover.png` | `PUT /rooms/{id}/messages/{messageID}/saved` |
| 同（保存済み） | `chat/saved/hover-saved.png` | `DELETE /workspaces/{id}/saved/{messageID}` |
| 「後で」の進行中 | `chat/saved/list.png` | `GET /workspaces/{id}/saved?state=in_progress` |
| 同（行のホバー） | `chat/saved/row-hover.png` | `PATCH /workspaces/{id}/saved/{messageID}`（`completed`） |
| 同（「その他」） | `chat/saved/menu.png` | 同上（`archived`）/ `DELETE` |
| 同（ダーク） | `chat/saved/list-dark.png` | — |
| 同（モバイル） | `chat/saved/mobile-list.png` | — |
| アーカイブ済み | `chat/saved/archived.png` | `GET /workspaces/{id}/saved?state=archived` |
| 同（「その他」） | `chat/saved/archived-menu.png` | `PATCH`（`in_progress`）/ `DELETE` |
| 完了済み | `chat/saved/completed.png` | `GET /workspaces/{id}/saved?state=completed` |
| 何も保存していない | `chat/saved/empty.png` | 同上（空） |
| 読めない行を外すときの確認 | `chat/saved/confirm.png` | `DELETE /workspaces/{id}/saved/{messageID}` |

- **ピン留めの印**: 本文の上に、ピンのアイコンと「〜がピン留め」を小さく出す（Slack と同じ位置）。押せないので緑にしない。
  削除したメッセージには出さない（削除でピンも外れる。ADR 0054 決定 4）。
- **ピン留めの操作は「…」の中**（Slack と同じ）。文言は Slack の公式ヘルプのとおり「チャンネルへピン留めする」/「チャンネルからピンを外す」。
  DM では「この会話にピン留めする」（公式）/「この会話からピンを外す」（外す方は公式の表記を確かめられていない）。
  メニューの幅を `w-52` から `w-60` に広げた（「チャンネルへピン留めする」が折り返したため）。
- **チャンネルのログ**は、ほかのシステムメッセージと同じ中央寄せの 1 行に、対象へ飛ぶ「メッセージを表示」のリンクを添える。
  対象が読めない・削除済みならリンクを出さない（ADR 0054 決定 3）。
- **ピン留めの一覧はヘッダーの「ピン留め N」から開く右のパネル**（スレッド・プロフィールと同じ枠。モバイルは全画面）。
  行を押すとそのメッセージへ飛ぶ。本文は 3 行で畳み、全文はタイムラインで読む。「ピンを外す」は行に乗せたときだけ出す（モバイルは常に出す）。
- **「後で」はサイドバーの「スレッド」の下の行から開く**（Phase 6.14.5 で左のメニューができたら、そちらへ移る）。
  スレッドの一覧と同じく、ルームの代わりにメインの領域に出す。件数のバッジは出さない（未読ではないので琥珀で呼ばない）。
- **「後で」の画面は Slack と同じく 3 つのタブ**で、件数は「進行中」にだけ付ける。行のホバーは「完了にする」（進行中だけ）と「その他」。
  その他はいまのタブ以外への移動（「進行中に移動する」「アーカイブ」）と「「後で」から外す」。リマインダーは 6.14 の後（ADR 0054）。
- **読めない行はゴミ箱のアイコンと「このメッセージは表示できません」**。押すと外すかどうかを確かめる（Slack と同じ流れ）。

#### デザインで決めた点（オーナーに確認する）

- **ピン留めしたメッセージに地の色を敷かなかった。** Slack は薄い黄色の地を敷くが、このアプリの琥珀は「いま起きていること」
  （自分宛てのメンション・飛んできた先）に使っていて、同じ地にすると見分けがつかなくなる。印の 1 行だけにした。
- **読めない行の文言は「このメッセージは表示できません」**にした。Slack は「保存したメッセージは削除されました」だが、
  読めないのか削除されたのかを区別しない（ADR 0054 決定 8）。確認のダイアログでは「削除されたか、読めなくなりました」と両方を書いた。
- **確認のボタンは「外す」**にした（Slack は「削除」）。消えるのは保存の行だけで、メッセージは消えないため。
- **ホバーの「後で」のアイコンは、保存済みで塗りつぶした緑**にした（押している状態。リアクションの自分のチップと同じ考え方）。
  名前は保存前が「「後で」に保存」、保存後が「「後で」から外す」（後者は Slack の公式の表記。前者は確かめられていない）。
- **ヘッダーのピン留めのボタンは件数を出す**（「メンバー」のように文字にすると、モバイルでヘッダーに入りきらない）。0 件でも出す。
