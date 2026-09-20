import { notFound } from "next/navigation";

import { previewCatalog } from "./catalog";
import { CatalogBrowser } from "./catalog-browser";

export const metadata = { title: "hibari / dev preview" };

/**
 * docs/ui/ の全画面・全状態の一覧（Phase 6-1）。開発用なので本番のビルドでは 404 にする。
 * 一覧が 100 件を超えたので、探す部分（検索・フェーズの絞り込み・グループの畳み）は CatalogBrowser に分けた。
 */
export default function PreviewIndex() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <main className="mx-auto flex max-w-240 flex-col gap-6 px-4 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight text-text">dev preview</h1>
        <p className="text-sm leading-relaxed text-text-secondary">
          docs/ui/screenshots/ の画面をモックデータで再現したもの。名前はスクリーンショットのファイル名と同じ。
          モバイルの画面はブラウザの幅を 768px 未満（スクリーンショットは 390px）にして見る。
        </p>
      </header>
      <CatalogBrowser entries={previewCatalog} />
    </main>
  );
}
