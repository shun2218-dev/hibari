import { loader } from "fumadocs-core/source";
import { slugsPlugin } from "fumadocs-core/source/plugins/slugs";
import { metaSchema, pageSchema } from "fumadocs-core/source/schema";
import { defineDocs } from "fumadocs-mdx/macro";
import { z } from "zod";

import { openapi } from "./openapi";
import { REST_API_DIR } from "./page-tree";
import { firstHeading } from "./title";

/**
 * docs/ をそのまま読む（ADR 0064 決定 1）。サイトのためにファイルを写さない。
 * front matter がないので、題名は最初の `# ` 見出しから取る。
 */
const docs = defineDocs({
  dir: "../docs",
  docs: {
    schema: (ctx) => pageSchema.extend({ title: z.string().default(firstHeading(ctx.source, ctx.path)) }),
  },
  meta: { schema: metaSchema },
});

export const source = loader(
  {
    docs: docs.toFumadocsSource(),
    // openapi.json から操作ごとのページを仮想的に作る（MDX のファイルを生成してコミットしない）。タグでフォルダにまとめる
    openapi: await openapi.staticSource({ baseDir: REST_API_DIR, groupBy: "tag" }),
  },
  {
    baseUrl: "/",
    plugins: [
      slugsPlugin((file, next) => {
        const slugs = next();
        // はじめに（docs/guide/index.md）をサイトのトップにする
        if (slugs.length === 1 && slugs[0] === "guide") return [];
        // README.md はそのフォルダの index（/adr/README → /adr）。GitHub がフォルダを開いたときに見せるものと同じ
        return slugs.at(-1) === "README" ? slugs.slice(0, -1) : undefined;
      }),
      openapi.loaderPlugin(),
    ],
  },
);
