# syntax=docker/dockerfile:1

# ---- dev: compose で使う。ソースは bind mount し、air でホットリロードする ----
# bookworm（glibc + gcc）にするのは、`go test -race` と sqlc（pg_query_go）が cgo を必要とするため。
FROM golang:1.27-bookworm AS dev
WORKDIR /src
# openssl は `make keys` で開発用の鍵を作るのに使う。
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*
# air / goose / sqlc / golangci-lint は tools/go.mod で固定し、`go tool -modfile=tools/go.mod` で呼ぶ。
# イメージに焼き込まず、実行時に named volume のキャッシュからビルドする（バージョンの正本を go.mod に 1 本化するため）。
CMD ["go", "tool", "-modfile=tools/go.mod", "air", "-c", ".air.toml"]

# ---- build: 本番用の静的バイナリ ----
FROM golang:1.27-bookworm AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY . .
ARG VERSION=dev
# CGO_ENABLED=0 で libc に依存しない静的バイナリにし、distroless/static で動かせるようにする。
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -X main.version=${VERSION}" -o /out/server ./cmd/server

# ---- prod: シェルもパッケージマネージャもない最小イメージ ----
FROM gcr.io/distroless/static-debian12:nonroot AS prod
COPY --from=build /out/server /server
USER nonroot:nonroot
EXPOSE 8080
ENTRYPOINT ["/server"]
