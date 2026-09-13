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

# ---- 品質 ----

.PHONY: test
test: ## Go の全テストを -race 付きで実行する（実物の Postgres / Redis を使う）
	$(RUN_GO) go test -race -count=1 ./...

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
