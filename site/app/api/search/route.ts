import { createFromSource } from "fumadocs-core/search/server";

import { source } from "@/lib/source";

export const revalidate = false;

// 日本語は空白で区切られないので、Intl.Segmenter で語に分ける。引く側（components/search.tsx）も同じにする
export const { staticGET: GET } = createFromSource(source, {
  tokenizer: { language: "multilingual" },
});
