# 開発・CI・本番で共通の Postgres イメージ。
#
# 素の postgres:16-alpine には pg_bigm が入っていないので、ここでビルドして足す（ADR 0061 決定 1）。
# 日本語の検索に 2-gram の索引が要るため。標準の pg_trgm は 3-gram で、
# 「会議」「面談」のような 2 文字の検索語では索引が使えず seq scan になる（ADR 0061 の「検証の結果」）。
#
# 版はタグで固定する。latest にすると、ある日ビルドの結果だけが変わる。
# pg_bigm は PGXS でビルドする。icu-dev と libxml2-dev は、postgres のサーバーのヘッダが
# unicode/ucol.h と libxml/parser.h を読むために要る（入れないと bigm_op.c のコンパイルで落ちる）。
FROM postgres:16-alpine

ARG PG_BIGM_VERSION=1.2-20250903

RUN apk add --no-cache --virtual .build-deps build-base curl icu-dev libxml2-dev \
 && curl -sSfL "https://github.com/pgbigm/pg_bigm/archive/refs/tags/v${PG_BIGM_VERSION}.tar.gz" -o /tmp/pg_bigm.tar.gz \
 && tar xzf /tmp/pg_bigm.tar.gz -C /tmp \
 && cd "/tmp/pg_bigm-${PG_BIGM_VERSION}" \
 # with_llvm=no: JIT 用のビットコードは使わないので、LLVM への依存を持ち込まない。
 && make USE_PGXS=1 with_llvm=no \
 && make USE_PGXS=1 with_llvm=no install \
 && cd / \
 && rm -rf "/tmp/pg_bigm-${PG_BIGM_VERSION}" /tmp/pg_bigm.tar.gz \
 && apk del .build-deps
