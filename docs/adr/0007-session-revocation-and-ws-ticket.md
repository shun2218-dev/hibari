# 0007. セッション単位の失効と ws-ticket の置き場所

- 状態: 採用
- 日付: 2026-09-13

## 背景

当初の設計には次の 3 つの問題があった。

1. 失効イベントが userID 単位だったので、1 台の端末でログアウトすると、そのユーザーの全端末の WebSocket が切れてしまう。
2. ws-ticket を auth が発行して Redis に置き、chat が GETDEL で消費する。これは「接点は userID と失効イベントの 2 つだけ」という境界（ADR 0001）を崩す 3 つ目の接点になる。
3. Access JWT はステートレスなので、失効イベントで WS を切っても、REST では有効期限（15 分）まで使えてしまう。

## 決定

### セッション ID（sid）
- `refresh_tokens.family_id`（ローテーションのチェーン ID）を**セッション ID**とし、Access JWT に `sid` クレームとして入れる。
- 失効イベント `auth:revoked` のペイロードは `{"sid": "..."}`、またはユーザーの全セッションを失効させる場合は `{"user_id": "...", "all": true}`。
  - ログアウト → その sid だけ
  - Refresh Token の再利用を検知 → その sid だけ
  - パスワードリセット、退会 → そのユーザーの全セッション
- Hub は userID と sid の両方から接続を引ける対応表を持つ。
- family の失効は `UPDATE refresh_tokens SET revoked_at = ..., revoked_reason = ... WHERE family_id = $1 AND revoked_at IS NULL` の 1 文で行う（再帰 CTE で `rotated_from` を辿らない）。

### ws-ticket
- 発行・保存・消費をすべて `internal/platform/authn` に置く。
- エンドポイントは `POST /api/v1/ws/ticket`（Access Token による認証が必要）。
- チケットは Redis に `authn:wsticket:{ticket}` → `{user_id, sid}` として TTL 30 秒で SETEX し、接続時に GETDEL で消費する。
- chat（WS ハンドラ）は `authn` から「検証済みの userID / sid」を受け取るだけで、Redis のキーの形を知らない。

### REST への失効の反映
- **最大 15 分の遅れを許容する**。WS は失効イベントで即座に切るが、REST は Access JWT の有効期限まで通る。
- JWT の検証はローカルで完結させる（Redis に問い合わせない）。

## 理由

- **sid が必要な理由**: 「ログアウト」はユーザーではなくセッション（端末）に対する操作。userID 単位の失効は、マルチデバイスで UX を壊す。
- **family_id を sid にする理由**: セッションの実体はすでに Refresh Token のチェーンとして存在する。新たにセッションテーブルを作ると、二重管理になる。
- **ws-ticket を authn に置く理由**: authn はすでに「トークンを検証して userID を渡す」役割を持っている。ws-ticket は「URL に載せられる、使い捨ての別形式のトークン」にすぎず、同じ責務に属する。
- **15 分を許容する理由**: 短い有効期限の JWT はこのトレードオフを前提にした方式で、業界でも一般的。拒否リストをリクエストごとに引くと、JWT の「ローカルで検証できる」利点（ADR 0001、Phase 5 のスケール）を失う。

## 検討した代替案

- **sid の拒否リスト（`authn:revoked:sid:{sid}`、TTL 15 分）をミドルウェアで毎回確認する**: 失効が即時に効くが、全リクエストに Redis の往復が 1 回増え、Redis の障害が認証の障害になる。将来の強化案として残す（Phase 7 以降）。
- **Access Token の TTL を 1〜5 分に縮める**: 遅れは縮むが、refresh の頻度が上がり、単一フライトの refresh の重要度が増す。今は 15 分で始める。
- **ws-ticket の代わりに `Sec-WebSocket-Protocol` ヘッダに JWT を載せる**: URL には載らないが、プロキシのログに残る可能性がある上、ヘッダの本来の用途から外れる。
- **ws-ticket を chat に置く**: auth のトークン形式を chat が知ることになり、境界が崩れる。

## 結果（トレードオフ）

- ログアウト後、奪われた Access Token は最大 15 分 REST で使える。ロールは JWT に入れず DB を正とするので、この間にキックされたユーザーの操作は authz で拒否される（権限の変更は即時に効く）。
- Redis Pub/Sub は at-most-once なので、失効イベントを取りこぼしたインスタンスでは WS が切れない場合がある。ws-ticket の消費時と、定期的な再検証（Phase 4 で間隔を決める）で補う。
- JWT のクレームが 1 つ増える。
