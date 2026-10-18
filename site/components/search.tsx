"use client";

import { useDocsSearch } from "fumadocs-core/search/client";
import { staticClient } from "fumadocs-core/search/client/orama-static";
import {
  SearchDialog,
  SearchDialogClose,
  SearchDialogContent,
  SearchDialogHeader,
  SearchDialogIcon,
  SearchDialogInput,
  SearchDialogList,
  SearchDialogOverlay,
  type SharedProps,
} from "fumadocs-ui/components/dialog/search";
import { create } from "zbsearch";

/**
 * サイトの検索（ADR 0064 決定 2）。既定の分割（english）では日本語が 1 件も引けないので、
 * Intl.Segmenter で語に分ける multilingual にする。索引を作る側（app/api/search/route.ts）と同じにする。
 */
export default function Search(props: SharedProps) {
  const { search, setSearch, query } = useDocsSearch({
    client: staticClient({
      initDB: () => create({ schema: { _: "string" }, components: { tokenizer: { language: "multilingual" } } }),
    }),
  });

  return (
    <SearchDialog search={search} onSearchChange={setSearch} isLoading={query.isLoading} {...props}>
      <SearchDialogOverlay />
      <SearchDialogContent>
        <SearchDialogHeader>
          <SearchDialogIcon />
          <SearchDialogInput />
          <SearchDialogClose />
        </SearchDialogHeader>
        <SearchDialogList items={query.data !== "empty" ? query.data : null} />
      </SearchDialogContent>
    </SearchDialog>
  );
}
