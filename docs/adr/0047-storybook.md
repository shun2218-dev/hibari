# 0047. /dev/preview を Storybook に移す（Phase 6.7.6。story を画面の正本にし、撮影と 1 対 1 の検査も移す）

- 状態: 採用
- 日付: 2026-09-21

## 背景

`docs/ui/screenshots/` の 134 枚の PNG には、それぞれ対になる「実装での再現」がある。
いまはそれを Next.js のアプリの中の開発用ページ `/dev/preview` が持っている。

| いまの持ち物 | 役割 |
|---|---|
| `web/app/dev/preview/catalog.ts` | 画面の一覧（名前・日本語の表示名・dark / mobile・足したフェーズ） |
| `web/app/dev/preview/screens.tsx` | 各画面の描画（presentational + `fixtures.ts` のモック） |
| `web/app/dev/preview/catalog-browser.tsx` | 一覧の検索・フェーズの絞り込み・グループの畳み（PR #74 で足した） |
| `web/app/dev/preview/[...name]/page.tsx` | 1 画面だけを枠なしで描く（撮影用） |
| `web/app/dev/preview/catalog.test.tsx` | PNG と 1 対 1 か、dark / mobile の命名が合っているか、全部描けるかの検査 |
| `tools/shoot-ui.mjs` / `make web-shots` | `/dev/preview/<名前>` を headless Chrome（CDP）で撮って PNG を置き換える |

この形の不都合。

- **一覧・検索・絞り込み・畳みを自前で持っている**（PR #74）。画面が 100 件を超えて必要になったもので、
  Storybook なら標準で付いてくる。ダークや幅の切り替えも同じ。
- **開発用の画面が本番のアプリと同じビルドに居る**。`process.env.NODE_ENV === "production"` で 404 にして避けている。
- **ADR 0046 で `ui.<独自ドメイン>` に Storybook を配ると決めた**。導入すると決まっているものと、自前の一覧が二重になる。
- **撮影の大きさがコマンドラインにしか無い**。`make web-shots names="chat/room-header-settings:900x120"` のように毎回手で渡しており、
  21 枚ある既定以外の大きさは、誰かの手元の履歴にしか残っていない。全部を撮り直す手段が無い。

オーナーと決めたこと（2026-09-20）。

- `/dev/preview` を Storybook に移し、**`/dev/preview` は同じ PR で消す**（二重管理を残さない）
- 着手は Phase 6.7.5（添付の拡大表示と削除）を終えてから
- 静的出力は Fly に置き、`ui.<独自ドメイン>` で配る（置き場所は ADR 0046 の決定 2・4 に入れてある）

移行そのものは「`screens.tsx` の 1 エントリ = story 1 つ」の機械的な作業で、画面が増えても手間は変わらない。

## 決定

### 1. Storybook 10 の `@storybook/nextjs-vite` を `web/` に入れ、`/dev/preview` は同じ PR で消す

`@storybook/nextjs-vite` は Next.js を Vite で動かす公式のフレームワーク。`next/font`・`next/link`・`next/navigation` を
Storybook 側が面倒を見るので、`app/` の部品をそのまま描ける。peer は `next: ^16`・`vite: ^5〜^8`・`react: ^19` で、
web の Next 16.3 / React 19.2、`vitest@5` が持つ vite 8.3 のどれとも合う。

消すもの: `web/app/dev/preview/` ごと（`catalog.ts` / `screens.tsx` / `catalog-browser.tsx` / `[...name]/page.tsx` /
`page.tsx` と、それぞれのテスト）。`fixtures.ts` だけは中身を変えずに移す（下の 3）。

### 2. story の id を PNG のパスにする

```
docs/ui/screenshots/chat/image-viewer-dark.png
                    ~~~~ ~~~~~~~~~~~~~~~~~~~
                    │    └ export 名 ImageViewerDark（Storybook が kebab-case にする）
                    └ meta.title
→ story id: chat--image-viewer-dark
```

- `meta.title` は **ASCII のグループ名**（`auth` / `chat` / `invite` / `workspace` / `settings`）。
  日本語のグループ名（「チャット」など）は付けない。id は title から作られるので、ここを日本語にすると id が PNG の名前とずれる。
- **export 名が PNG のファイル名**になる。日本語の表示名は story の `name` に置く（表示名を変えても id は動かない）。
- 対応表を別に持たない。`parameters.screenshot.name` のような項目も要らない。
  名前が食い違ったら、下の 6 の検査が落ちる。

### 3. story は `web/stories/<グループ>.stories.tsx` に置く

`screens.tsx` の各エントリをそのまま story の `render` にし、`fixtures.ts` は `web/stories/fixtures.ts` に移す。
**中身は変えない**（撮り直しの diff を空にするため。下の 10）。

部品ごとの story（`components/**/*.stories.tsx`）は移行では作らない。移行の対象は「PNG と 1 対 1 の画面」だけで、
部品ごとの story はそのどれとも対にならない。`.storybook/main.ts` の glob は両方を拾える形にしておく。
→ **オーナーの要望（2026-09-21）で、移行の直後に足すことにした（下の 12）。**

### 4. dark と mobile は story の parameters に持たせ、decorator が当てる

```ts
parameters: { theme: "dark", screenshot: { size: "390x844" } }
```

`.storybook/preview.tsx` の decorator が、`theme === "dark"` のとき `<html data-theme="dark">` を付ける。
いまの `PreviewScreen` が `useEffect` で同じことをしている理由と同じで、**body の直下に出るもの**
（絵文字のピッカー。`components/ui/portal.tsx`）がダークを拾えなくなるため、iframe のルート要素に置く必要がある。

命名の規則（`-dark` で終わる ⟺ ダーク、`mobile-` で始まる ⟺ 390x844）は、**検査としてだけ残す**（下の 6）。
decorator が名前から推測する形にはしない。名前に意味を持たせる場所は 1 つ（検査）にしておく。

### 5. 「どのフェーズで足したか」は tag にする

`tags: ["since:6.7"]`。Storybook のサイドバーは tag での絞り込みを持っているので、PR #74 で作った
フェーズのチップ（`previewSinceOrder` / `previewSinceLabels` / `filterPreviewCatalog`）はそのまま捨てられる。
検索もサイドバーのものを使う。`catalog-browser.tsx` と `catalog-browser.test.tsx` は消える。

### 6. 1 対 1 と命名の検査は、portable stories でいまの vitest に残す

`@storybook/nextjs-vite` の `composeStories` で story をそのまま render し、`catalog.test.tsx` の 5 つの検査を移す。

1. PNG と story が 1 対 1（`docs/ui/screenshots/**.png` の集合 == story id を `/` に直した集合）
2. 重複が無い
3. すべての story が描ける（見出しかボタンが 1 つ以上ある＝空の描画になっていない）
4. `-dark` で終わる story だけが `theme: "dark"` を持ち、`mobile-` で始まる story だけが mobile の大きさを持つ
5. すべての story が `since:` の tag を 1 つ持つ

**`@storybook/addon-vitest` は入れない。** peer が `vitest: ^3 || ^4` で web の `vitest@5` と合わない。
合っていたとしても、ブラウザモード（`@vitest/browser` + Playwright）を CI に足すことになり、
いまの jsdom の検査で足りるものに対して重い。peer が広がったら見直す。

### 7. 撮影は `index.json` と `iframe.html` に向ける

`tools/shoot-ui.mjs` の変更は URL の組み立てだけで、CDP の `Emulation.setDeviceMetricsOverride` も待ち時間もそのまま使える。

- 撮る対象の一覧: Storybook が配る `/index.json`（story id・title・name・tags が入っている）
- 撮る URL: `iframe.html?id=<story id>&viewMode=story`（枠の無い story だけのページ）
- 名前: story id の `--` を `/` に直したもの（決定 2）

引数を渡さなければ **app 由来の PNG を全部撮り直す**（下の 8）。名前を渡せば今までどおりその画面だけを撮る。

`HIBARI_SCREENSHOTS=1`（`next.config.ts` の `devIndicators: false`）は**要らなくなる**ので、一緒に消す。
Next.js の開発インジケータは Storybook の iframe には出ない。

### 8. 撮影の大きさと「出どころ」を story に持たせる

```ts
parameters: { screenshot: { size: "900x120", source: "app" } }
```

- `size`: 既定は `1280x800`、`mobile-` で始まる story は `390x844`。部分を切り出したフレーム（ダイアログやヘッダーだけ）はここに書く。
  いまコマンドラインにしか無い 21 枚の大きさが、これでリポジトリに残る。
- `source`: `"app"`（`/dev/preview` から撮った PNG）か `"design"`（Claude Design から取り込んだ PNG）。
  引数なしの撮り直しと、下の 10 の検査は **`"app"` だけ**を対象にする。`"design"` の PNG は実装から撮ったものではないので、
  撮り直すと必ず差が出る（`docs/ui/README.md` が「Claude Design 側も直す」と書いている分）。

**parameters は `index.json` に載らない**（載るのは tags まで）。かといって `size:900x120` のような tag にすると、
サイドバーの絞り込みに 20 個の無関係なチップが並ぶ（tag は filter に出るかどうかを選べない）。
そこで decorator が `<html data-shot-size="900x120" data-shot-source="app">` に写し、
`shoot-ui.mjs` は描画したあとに CDP の `Runtime.evaluate` でそれを読んでから、大きさを当てて撮り直す。
公開されている API（decorator と DOM）だけで済み、Storybook の内部（`__STORYBOOK_PREVIEW__` など）に触らない。

### 9. フォントと CSS は `app/layout.tsx` と同じ状態にする

`.storybook/preview.tsx` で `app/globals.css` を import し、`app/fonts.ts` の 3 つの `variable` クラスを
`<html>` に付ける（`layout.tsx` がやっているのと同じこと）。付けないと `--font-sans` が効かず、
**撮り直しの PNG が全部変わる**。

`next/font` は `@storybook/nextjs-vite` でそのまま動く。既知の違いは `display` が `block` 固定になることだけで、
撮影は 2 秒待ってから撮るので結果は変わらない（むしろ swap の途中で撮る事故が減る）。

### 10. 移行 PR の通過条件は「app 由来の PNG を全部撮り直して diff が空」

`make web-shots`（引数なし）を通して `git diff docs/ui/screenshots/` が空になること。差が出たら原因
（フォント・背景・スクロールバー・開発インジケータ）を潰す。潰しきれない差は、オーナーが目視で承認してから PNG を更新する。

ただし `docs/ui/README.md` の「撮り直しが要るもの」に挙がっている **7 枚は最初から古い**
（サイドバーのバッジの出し方を変えた分と、Linux の Chromium で撮った分）。この移行では直さず、
`source: "app"` のまま **既知の差として PR に書き出す**。撮り直しはオーナーの手元で、移行のあとに行う。

### 11. CI に `build-storybook` を足す

`.github/workflows/web.yml` の `next build` の隣に `npm run build-storybook` を足す。
ADR 0046 でこの出力を Fly に配ると決めているので、壊れたら PR で止める。

### 12. 部品ごとの story を足す（2026-09-21 追記）

移行のあと、オーナーの要望で部品のカタログを足す。**画面の story とは別の種類**として扱う。

| | 画面の story | 部品の story |
|---|---|---|
| 置き場所 | `web/stories/<グループ>.stories.tsx` | `web/components/**/*.stories.tsx`（実装の隣） |
| title | `chat` などの ASCII のグループ名 | `components/ui/Button` のようにパスに合わせる |
| 目的 | `docs/ui/screenshots/` の PNG の再現 | props と状態の見本帳 |
| `args` / controls | 使わない | 使う |
| テーマ | `parameters.theme` で固定（PNG と 1 対 1 のため） | ツールバーの globals で切り替える |
| `autodocs` | 付けない（PNG と対にならない項目がサイドバーに増えるため） | 付ける |
| 撮影 | する | **しない** |

**見分けは `screenshot` の tag ひとつにする。** 画面の story の meta に `tags: ["screenshot"]` と
`parameters: { screenshot: { source: "app" } }` を置き、story ごとに大きさや出どころを上書きする。

- `tools/shoot-ui.mjs` は `index.json` の tag で撮る対象を選ぶ（parameters は index.json に載らないので、tag が要る）。
- decorator は `parameters.screenshot` の有無で囲いを変える（画面は全画面、部品は余白のある台の上）。
- 検査（`web/stories/stories.test.tsx`）は、画面の story にだけ PNG との 1 対 1 を求め、
  部品の story には「`screenshot` を持たない」「`autodocs` を持つ」「空でなく描ける」を求める。
  どちらも glob で集めるので、**ファイルを足せば自動で検査に入る**。

**作る範囲**（オーナーの判断、2026-09-21）: `components/ui/` の基礎部品と、「その部品だけが持つ状態の軸」があるもの。

- 作る: `Button` / `Alert` / `Avatar` / `Badge` / `Field` / `Choice` / `Dialog` / `Spinner` / `Link` / `Icons`、
  `MessageItem`（送信の状態）/ `Composer`（添付と補完）/ `ConnectionBanner` / `MessageReactions` / `MessageLinkCard` / `InviteAccept`
- 作らない: `Timeline` / `Sidebar` / `ChatLayout` のような大きい部品（画面の story とほぼ同じものが二重になり、画面を直すたびに両方を直すことになる）
- 作らない: `Portal` / `AnchoredPanel` / `Popover`（単体では見た目を持たない土台。使っている部品の story で見える）

## 理由

- **一覧の道具を自前で持たない。** 検索・絞り込み・畳み・ダーク・幅の切り替えは、Storybook の標準の機能。
  PR #74 で作ったものは、Storybook を入れると同じものの焼き直しになる。
- **story を正本にすると、対応表が消える。** id が PNG のパスになるので、`catalog.ts` のような「名前の表」が要らない。
  ずれたら検査で落ちる。
- **撮影の情報が story に集まる。** 大きさと出どころが残るので、「全部撮り直す」が初めて可能になる。
  デザイントークンを触ったときに全体の差を見られる。
- **開発用の画面がアプリから消える。** 本番のビルドに開発用のルートが混ざらなくなり、`NODE_ENV` の分岐も消える。

## 検討した代替案

- **`/dev/preview` を残して Storybook も入れる** → 同じ画面を 2 か所で書くことになる。オーナーが「同じ PR で消す」と決めた。
- **`@storybook/react-vite`（Next 抜き）** → `next/font`・`next/link`・`next/navigation` のモックを自前で持つことになる。
  `next/font` を外すと、撮り直しで全部の PNG に差が出る。
- **Storybook を入れず `/dev/preview` を育てる** → ADR 0046 で `ui.` に Storybook を配ると決めた分と食い違う。
  一覧の機能を自前で書き続けることになる。
- **story の id を `parameters.screenshot.name` で明示する** → 対応表を持つのと同じで、ずれを検査で見るしかなくなる。
  id から決まるなら、ずれようがない。
- **大きさを tag（`size:900x120`）で持つ** → `index.json` から読めて楽だが、サイドバーの絞り込みに 20 個のチップが並ぶ。
  tag を filter から隠す設定は無い。
- **`@storybook/addon-vitest` で story をブラウザモードでテストする** → peer が `vitest: ^3 || ^4` で web の 5 と合わない。
- **視覚回帰（Chromatic など）を一緒に入れる** → 正本は PNG とオーナーの目視という今の形を変えない。フェーズの範囲外。

## 結果（トレードオフ）

- **依存が増える**（Storybook 10 一式）。`npm ci` と CI の時間が延びる。`build-storybook` のぶんも足す。
- **export 名が PNG のファイル名を決める**ので、export 名を変えると PNG の名前も変わる。検査が落ちるので黙ってずれることはない。
- **`/dev/preview` の URL が無くなる。** `docs/ui/README.md`・`docs/roadmap.md`・部品のコメントにある案内を全部書き換える。
  以後のフェーズの「デザインは `/dev/preview` に描いて `docs/ui/` に足す」は「story に描いて」になる。
- **Storybook の起動が増える。** 撮影は `npm run storybook`（または `storybook build` の静的出力）が動いている前提になる。
  `make web-shots` がその面倒を見る。
- **既知の古い 7 枚は移行では直らない。** 撮り直しはオーナーの手元で行う（決定 10）。
