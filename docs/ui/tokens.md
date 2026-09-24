# デザイントークン

値の正本は `web/app/globals.css`。この文書は「どのトークンをいつ使うか」を決める。値を変えるときは globals.css を直し、この表も合わせる。

## 使い方の原則

- コンポーネントに色・余白・角丸・フォントサイズの生の値を書かない。Tailwind の任意値（`text-[#2F6F62]`、`p-[13px]`）も使わない。
- Tailwind の既定テーマは `--*: initial` で捨ててある。`text-red-500` や `rounded-xl` は生成されないので、ここにあるトークンだけで組む。
- 新しいトークンが必要になったら、追加する前にオーナーに確認する。
- ダークテーマは `<html data-theme="dark">` で切り替える。OS の設定には追従しない（設定画面の「外観」でユーザーが選ぶ）。`dark:` バリアントは同じ属性を見る。

## 色

**例外**: ファビコンと OGP 画像（`docs/ui/brand/`）は画像なので CSS 変数を読めず、ライトの値をそのまま書いている。ここの値を変えたら `make brand` で書き出し直す（ADR 0063）。

### 2 つのアクセントの使い分け

hibari の配色の核は「**緑 = 操作できるもの**」「**琥珀 = いま起きていること**」の分離。

- **primary（緑）**: ボタン、リンク、選択中のチャンネル、トグルやラジオのオン、フォーカスリング。
- **attention（琥珀）**: 未読バッジ、未読の区切り線、入力中インジケータ、再接続中 / 同期中バナー、メール確認待ち。
- 未読バッジは押せる要素ではないので primary にしない。逆に、琥珀の要素を押せるようにしない。
- **pinned（黄土）** はピン留めしたメッセージだけに使う（ADR 0054。Slack の地の色に合わせてオーナーと足した）。
  「いま起きていること」ではないので琥珀にしない。自分宛てのメンションや飛んできた先（琥珀の地）と重なったときは、そちらを優先する。
- 「接続が復帰しました」バナーは、状態が落ち着いたことを示すので primary-subtle を使う。

### 一覧

Tailwind の列は、そのトークンから生成される代表的なユーティリティ。

| トークン | ライト | ダーク | Tailwind | 用途 | デザイン上の名前 |
|---|---|---|---|---|---|
| `--color-background` | `#f2f5f2` | `#101614` | `bg-background` | ページの地。認証カードの背景、未読区切り線のラベルの背景 | `--bg` |
| `--color-surface` | `#ffffff` | `#171f1c` | `bg-surface` | サイドバー・メッセージ領域・パネル・カード・入力欄 | `--surface` |
| `--color-surface-muted` | `#e8ede9` | `#1f2926` | `bg-surface-muted` | ホバー、日付の区切りのラベル、無効なボタン、アイコンの台座 | `--surface-2` |
| `--color-border` | `#d7ded9` | `#2b3733` | `border-border` | 区切り線、入力欄・カードの枠、オフのトグル | `--border` |
| `--color-text` | `#16201d` | `#e8eeea` | `text-text` | 本文、名前、見出し | `--ink` |
| `--color-text-secondary` | `#47544d` | `#aab8b1` | `text-text-secondary` | ラベル、説明文、アイコン | `--ink-2` |
| `--color-text-muted` | `#78857e` | `#7e8c85` | `text-text-muted` | 時刻、補足、プレースホルダ、削除済みメッセージ | `--muted` |
| `--color-primary` | `#2f6f62` | `#5aa694` | `bg-primary` / `text-primary` | 主ボタン、リンク、選択中の縦バー、フォーカスリング | `--brand` |
| `--color-primary-hover` | `#245a4f` | `#6fbba8` | `hover:bg-primary-hover` | primary のホバー | `--brand-hover` |
| `--color-primary-subtle` | `#e3efea` | `#1b302b` | `bg-primary-subtle` | 選択中の行、選択中のラジオカード、「このデバイス」「管理者」バッジ、復帰バナー | `--brand-tint` |
| `--color-on-primary` | `#ffffff` | `#101614` | `text-on-primary` | primary の上の文字 | `--on-brand` |
| `--color-code-text` | `#a84e17` | `#e8912d` | `text-code-text` | インラインコードの文字（入力欄と本文。ADR 0052。オーナーの確認: 2026-09-21）。コードの地に対してライト 4.7 / ダーク 6.0 のコントラスト | —（Slack の橙に合わせて足した） |
| `--color-attention` | `#c08519` | `#d9a441` | `bg-attention` | 未読バッジの地、未読の区切り線 | `--live` |
| `--color-attention-subtle` | `#fbf1dc` | `#2e2415` | `bg-attention-subtle` | 再接続中 / 同期中バナー、「オーナー」バッジ、注意書きの地 | `--live-tint` |
| `--color-attention-text` | `#7a5410` | `#d9a441` | `text-attention-text` | 琥珀系の文字（入力中、バナー、「ここから未読」） | `--live-fg` |
| `--color-on-attention` | `#16201d` | `#101614` | `text-on-attention` | 未読バッジの数字 | `--on-live` |
| `--color-pinned` | `#9a7b2f` | `#cbb06a` | `text-pinned` | ピン留めしたメッセージの印のアイコン（ADR 0054） | — |
| `--color-pinned-subtle` | `#f5f1e3` | `#25241b` | `bg-pinned-subtle` | ピン留めしたメッセージの行の地（ADR 0054） | — |
| `--color-highlight` | `#f3e2a9` | `#4d431c` | `bg-highlight` | 検索で一致した部分の地（ADR 0061。オーナーの確認: 2026-09-23）。マーカーで塗ったように見せる。琥珀・黄土より彩度を上げて、未読の印やピン留めの行と見分ける | —（Slack の黄色に当たるが、値は hibari の面に合わせた） |
| `--color-danger` | `#b23a2e` | `#d9705f` | `text-danger` / `bg-danger` | 送信失敗、アップロード失敗、ログアウト・削除・キックなど破壊的な操作 | `--danger` |
| `--color-danger-subtle` | `#f8e7e4` | `#33201d` | `bg-danger-subtle` | ログインエラー、失敗したファイルチップ、「取り消し済み」バッジ | `--danger-tint` |
| `--color-online` | `#3e9c7e` | `#4fb08f` | `bg-online` | presence のオンラインのドット（オフラインはドットを出さない） | `--online` |
| `--color-overlay` | `rgb(22 32 29 / 0.32)` | `rgb(6 10 9 / 0.55)` | `bg-overlay` | ダイアログ・ボトムシートの背後のスクリム | `--scrim` |
| `--color-avatar-1`〜`6` | 下記 | 下記 | `bg-avatar-1` など | アバターの地。ユーザー / ワークスペースごとに 1 つ割り当てる | `--avatar-1`〜`6` |
| `--color-on-avatar` | `#ffffff` | `#101614` | `text-on-avatar` | アバターの頭文字 | `--on-avatar` |

アバターの色:

| | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|
| ライト | `#64786e` | `#86765c` | `#5e6e80` | `#746a7d` | `#4f7268` | `#7c6f5b` |
| ダーク | `#89a096` | `#ad9b7c` | `#8496aa` | `#9c90a8` | `#7fa095` | `#a3947a` |

番号はユーザー / ワークスペースの ID を FNV-1a でハッシュして決める（`web/lib/avatar.ts`、ADR 0018）。表示名からは決めないので、名前を変えても色は変わらない。

## 文字

| トークン | 値 | Tailwind | 用途 |
|---|---|---|---|
| `--font-sans` | Instrument Sans, Zen Kaku Gothic New, system-ui | `font-sans` | 既定。欧文は Instrument Sans、和文は Zen Kaku Gothic New で描く。読み込みは `web/app/fonts.ts`（next/font） |
| `--font-mono` | JetBrains Mono | `font-mono` | 時刻、ハンドル（`@naoki`）、招待リンク、メールアドレス、ブランド名の横の `chat`。桁をそろえて視線を上下させないため |

### サイズ（7 段階 + 写真の頭文字 + LP の見出し）

| トークン | 値 | Tailwind | 用途 |
|---|---|---|---|
| `--text-2xs` | 11px | `text-2xs` | 時刻、未読バッジ、小さなバッジ、キーボード操作のヒント |
| `--text-xs` | 12px | `text-xs` | フォームのラベル、補足説明、セクション見出し、送信失敗の表示 |
| `--text-sm` | 13px | `text-sm` | 説明文、サブテキスト、テキストボタン、検索欄 |
| `--text-base` | 14px | `text-base` | チャンネル名・メンバー名、メニュー項目、小さめのボタン |
| `--text-lg` | 15px | `text-lg` | **メッセージ本文、入力欄、主ボタン、ヘッダーのチャンネル名**。body の既定 |
| `--text-xl` | 20px | `text-xl` | 画面・カードの見出し、サイドバーのロゴ |
| `--text-2xl` | 26px | `text-2xl` | 認証画面のロゴ |
| `--text-avatar` | 112px | `text-avatar` | **段階の外**。プロフィールのパネルの大きな写真に出す、画像のない人の頭文字だけ（ADR 0050） |
| `--text-display` | 52px | `text-display` | **段階の外**。LP の最初の見出し（デスクトップ）だけ。アプリの画面では使わない（ADR 0063） |
| `--text-display-sm` | 32px | `text-display-sm` | **段階の外**。LP の最初の見出し（モバイル）だけ |

`text-base` が 14px なのは、アプリの UI 部品の標準を 14px、読ませる本文を 15px（`text-lg`）として分けているため。Tailwind の既定（base = 16px）とは違う。

### ウェイト・行送り・字間

| トークン | 値 | Tailwind | 用途 |
|---|---|---|---|
| `--font-weight-normal` | 400 | `font-normal` | 本文 |
| `--font-weight-medium` | 500 | `font-medium` | 名前、ラベル、テキストボタン |
| `--font-weight-semibold` | 600 | `font-semibold` | ボタン、ヘッダー、バッジ、自分の名前 |
| `--font-weight-bold` | 700 | `font-bold` | 見出し、ロゴ |
| `--leading-none` | 1 | `leading-none` | アイコンと並べる 1 行の要素 |
| `--leading-normal` | 1.6 | `leading-normal` | エラーメッセージ、送信失敗の表示など短い補足 |
| `--leading-relaxed` | 1.75 | `leading-relaxed` | メッセージ本文、説明文。デザインで「半日開いたままでも疲れない」として確定した値 |
| `--tracking-tight` | -0.015em | `tracking-tight` | ロゴ |

デザインには行送り 1.7 と 1.8 も少数あったが、1.75 と見分けがつかないので `--leading-relaxed` に寄せた。

## 余白・サイズ

| トークン | 値 | 用途 |
|---|---|---|
| `--spacing` | 4px（0.25rem） | すべての余白・幅・高さの単位。`p-3` = 12px、`h-11` = 44px、`gap-1.5` = 6px |

4px の倍数を基本にするが、デザインには半分の刻み（2px）も出てくる。Tailwind の `.5` で書く:
`px-3.5` = 14px（カード・行の左右）、`h-8.5` = 34px（検索欄）、`h-9.5` = 38px（メニューの項目）、`size-6.5` = 26px（小さいアバター）。
これ以外の端数は使わない。

デザインで繰り返し出てくるサイズ（新しいトークンにはせず、spacing の倍数で書く）:

| 要素 | サイズ | Tailwind |
|---|---|---|
| 入力欄・主ボタン（認証・フォーム） | 高さ 44px | `h-11` |
| ヘッダー | 高さ 56px | `h-14` |
| アイコンボタン、送信ボタン | 32px | `size-8` / `h-8` |
| アバター（メッセージ・DM 一覧 / メンバー / プロフィール） | 40px / 32px / 56px | `size-10` / `size-8` / `size-14` |
| サイドバー / メンバーパネル / 設定のナビ | 幅 288px / 280px / 240px | `pane-sidebar` / `pane-members` / `w-60` |
| フォームの最大幅 / 設定の本文の最大幅 | 400px / 640px | `max-w-100` / `max-w-160` |

## 中身に合わせて伸びる入力欄（ADR 0048）

入力欄（`Composer`）とメッセージの編集欄（`MessageEditor`）は、改行や折り返しで増えた分だけ縦に伸びる。

| トークン | 値 | Tailwind | 用途 |
|---|---|---|---|
| `--composer-max-lines` | 16 | `composer-lines` | ここを超えると、入力欄の中でスクロールする（Slack に合わせた） |

上限を px ではなく**行数**で持つのは、上限の意味が「何行まで見せるか」だから。
`@utility composer-lines` が `calc(var(--composer-max-lines) * 1lh + var(--spacing) * 2)` にするので、
文字サイズや行送りを変えても「16 行ぶん」の意味が保たれる（`1lh` はその要素の 1 行ぶん）。

## 伸縮できるエリア（ADR 0048）

サイドバー・メンバー・スレッドのパネルの幅は、ユーザーが境目をドラッグして変えられる（md 以上だけ）。
**既定・最小・最大はここが正本**で、コンポーネントにも TypeScript にも数値を書かない。
ユーザーが決めた値は `lib/pane-size.ts` が `<html>` の style で `--pane-*` を上書きし、限界は `@utility` の
`clamp()` が守る（覚えている値が古くても、窓が狭くても、この範囲から出ない）。

| トークン | 既定 | 最小 | 最大 | Tailwind |
|---|---|---|---|---|
| `--pane-sidebar` | 288px | 200px | `min(480px, 40vw)` | `md:pane-sidebar` |
| `--pane-members` | 280px | 220px | `min(480px, 40vw)` | `md:pane-members` |
| `--pane-thread` | 384px | 280px | `min(640px, 50vw)` | `md:pane-thread` |

- 最大に `vw` を混ぜてあるのは、窓が狭いときにサイドバーとパネルで本文が潰れないようにするため。
- 取っ手（`components/ui/resize-handle.tsx`）は当たりを 8px 取り、見えるのはポインタを乗せたときと
  動かしている間の 2px の primary の線だけ（サイドバーの選択中の縦バーと同じ太さ）。普段は出さない。
- **入力欄の高さは変えられない**（Slack も変えられない）。下の「中身に合わせて伸びる入力欄」を参照。

## 角丸（4 段階）

| トークン | 値 | Tailwind | 用途 |
|---|---|---|---|
| `--radius-sm` | 8px | `rounded-sm` | アイコンボタン、送信ボタン、検索欄、ホバーアクションのバー |
| `--radius-md` | 12px | `rounded-md` | 入力欄、主ボタン、カード・リスト、ラジオカード、ファイルチップ |
| `--radius-lg` | 16px | `rounded-lg` | 認証カード、ダイアログ、モバイルのボトムシート |
| `--radius-full` | 9999px | `rounded-full` | アバター、バッジ、presence のドット、トグル |

## リストの記号（ADR 0051）

本文の箇条書きは、段ごとに記号を変える（Slack と同じ。オーナーの確認: 2026-09-21）。1 段目は Tailwind の既定の `list-disc`。

| トークン | 値 | Tailwind | 用途 |
|---|---|---|---|
| — | disc | `list-disc` | 箇条書きの 1 段目（•） |
| `--list-style-type-circle` | circle | `list-circle` | 箇条書きの 2 段目（◦） |
| `--list-style-type-square` | square | `list-square` | 箇条書きの 3 段目（▪） |

## 影・動き・ブレークポイント

| トークン | 値 | Tailwind | 用途 |
|---|---|---|---|
| `--shadow-overlay` | `0 8px 24px var(--color-overlay)` | `shadow-overlay` | ダイアログ、ポップオーバー（ロールの選択、管理できない理由） |
| `--ease-slide` | `cubic-bezier(0.32, 0.72, 0, 1)` | `ease-slide` | モバイルで一覧 ↔ 詳細をスライドするとき（`duration-280` と組み合わせる） |
| `--animate-spin` | 900ms で 1 回転 | `animate-spin` | 再接続中バナーのスピナー |
| `--animate-typing-dot` | 1.2s で点滅 | `animate-typing-dot` | 入力中インジケータの「・・・」。3 つの点を 0.2s ずつずらす |
| `--breakpoint-md` | 768px | `md:` | これ未満がモバイルのレイアウト |

`prefers-reduced-motion: reduce` のときは globals.css でアニメーションとトランジションを止める。

## フォーカス

キーボード操作時のフォーカスリングは globals.css の `:focus-visible` で一律に `2px solid var(--color-primary)` を付ける。入力欄は枠の内側（`outline-offset: -2px`）にリングを出すデザインなので、入力欄のコンポーネントで offset だけ上書きする。

## カーソル

押せるものにはポインタを出す。Tailwind v4 の preflight は `button` に `cursor: pointer` を当てない（v3 から変わった）ので、
globals.css の `@layer base` で `button:not(:disabled)` / `[role="button"]` / `summary` に戻している（オーナーの判断、2026-09-20）。

- 無効なボタンは `disabled:cursor-not-allowed`（押せないことを先に伝える）。ユーティリティはレイヤの順で base より後に当たる。
- **画像の添付だけは `cursor-zoom-in`**。ボタンに見えないので、押すと拡大表示が開くことをカーソルで示す（ADR 0045）。
  拡大表示を開けない画像（送信中の添付）にはカーソルも出さない。
