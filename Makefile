# 開発用のコマンド。Go / goose / sqlc / psql はホストに要求せず、すべてコンテナ内で実行する。
# Next.js（web/）だけはホストで動かす（CLAUDE.md「技術スタック」）。

COMPOSE ?= docker compose
# server イメージを使った使い捨てのコンテナ。依存（postgres / redis / minio）は必要なら自動で起動する。
# ポートは公開しないので、`make up` で動いている server と衝突しない。
RUN_GO  := $(COMPOSE) run --rm --no-TTY server
GOTOOL  := go tool -modfile=tools/go.mod

.DEFAULT_GOAL := help

.PHONY: help
help: ## コマンドの一覧を表示する
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

# ---- 一括 ----

# 前提のターゲットに並べず $(MAKE) で順に呼ぶのは、`make -j` でも
# 「鍵の生成 → コンテナの起動 → マイグレーション → Next.js」の順序を崩さないため。
# 鍵は server の起動に必須（ないと起動時に落ちる）なので、コンテナより先に作る。
# web はフォアグラウンドで動くので最後に置く。Ctrl+C で止まるのは Next.js だけで、
# コンテナは動いたまま残る（止めるときは `make down`）。
.PHONY: dev
dev: ## 全部をローカルで起動する（鍵の生成 → compose の起動 → マイグレーション → ホストで Next.js）
	$(MAKE) keys
	$(MAKE) up
	$(MAKE) migrate-up
	$(MAKE) web

# ---- compose ----

.PHONY: up
up: ## 全コンテナを起動する（server は air でホットリロード）
	$(COMPOSE) up -d --build

.PHONY: down
down: ## 全コンテナを停止する（データのボリュームは残す）
	$(COMPOSE) down

.PHONY: logs
logs: ## ログを追いかける（例: make logs s=server）
	$(COMPOSE) logs -f $(s)

.PHONY: ps
ps: ## コンテナの状態を表示する
	$(COMPOSE) ps

.PHONY: sh
sh: ## server コンテナでシェルを開く
	$(COMPOSE) exec server bash

.PHONY: psql
psql: ## 開発用 DB に psql で接続する
	$(COMPOSE) exec postgres sh -c 'psql -U "$$POSTGRES_USER" "$$POSTGRES_DB"'

# ---- DB ----

# goose はコンテナ内の DATABASE_URL（compose.yaml で組み立てる）に対して実行する。
GOOSE := $(GOTOOL) goose -dir db/migrations postgres

.PHONY: migrate-up
migrate-up: ## マイグレーションを最新まで適用する（開発用 DB とテスト用 DB の両方）
	$(RUN_GO) sh -c '$(GOOSE) "$$DATABASE_URL" up && $(GOOSE) "$$TEST_DATABASE_URL" up'

.PHONY: migrate-down
migrate-down: ## マイグレーションを 1 つ戻す（開発用 DB とテスト用 DB の両方）
	$(RUN_GO) sh -c '$(GOOSE) "$$DATABASE_URL" down && $(GOOSE) "$$TEST_DATABASE_URL" down'

.PHONY: migrate-status
migrate-status: ## 開発用 DB のマイグレーションの状態を表示する
	$(RUN_GO) sh -c '$(GOOSE) "$$DATABASE_URL" status'

.PHONY: migrate-new
migrate-new: ## マイグレーションを作る（例: make migrate-new name=add_reactions）
	@test -n "$(name)" || (echo "usage: make migrate-new name=<snake_case>" >&2; exit 1)
	$(RUN_GO) $(GOTOOL) goose -dir db/migrations -s create $(name) sql

.PHONY: sqlc
sqlc: ## db/queries から Go のコードを生成する（sqlc.yaml）
	$(RUN_GO) $(GOTOOL) sqlc generate

# ---- 品質 ----

.PHONY: test
test: ## Go の全テストを -race 付きで実行する（テスト用 DB を最新のスキーマにしてから、実物の Postgres / Redis で）
	$(RUN_GO) sh -c '$(GOOSE) "$$TEST_DATABASE_URL" up && go test -race -count=1 ./...'

.PHONY: lint
lint: ## go vet と golangci-lint を実行する
	$(RUN_GO) sh -c 'go vet ./... && $(GOTOOL) golangci-lint run ./...'

# ---- web（ホストで実行する） ----

.PHONY: web
web: ## ホストで Next.js の開発サーバーを起動する（API は compose の server）
	@test -f web/.env.local || cp web/.env.example web/.env.local
	cd web && npm install && npm run dev

.PHONY: web-test
web-test: ## web/ の lint / 型チェック / Vitest を実行する
	cd web && npm run lint && npm run typecheck && npm test

# ---- その他 ----

.PHONY: keys
keys: ## 開発用の JWT 署名鍵（Ed25519）を keys/ に生成する。既存の鍵は上書きしない
	@mkdir -p keys
	@if [ -e keys/jwt_ed25519.pem ]; then echo "keys/jwt_ed25519.pem already exists"; exit 0; fi; \
	$(RUN_GO) openssl genpkey -algorithm ed25519 -out keys/jwt_ed25519.pem && \
	chmod 600 keys/jwt_ed25519.pem && echo "generated keys/jwt_ed25519.pem"

.PHONY: diagrams
diagrams: ## docs/*.mermaid から docs/*.svg を生成する（ADR 0009）
	./tools/render-diagrams.sh
