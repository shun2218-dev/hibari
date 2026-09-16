import Link from "next/link";
import { notFound } from "next/navigation";

import { type PreviewGroup, previewCatalog, previewGroupOf, previewGroups } from "./catalog";

export const metadata = { title: "hibari / dev preview" };

/**
 * docs/ui/ の全画面・全状態の一覧（Phase 6-1）。開発用なので本番のビルドでは 404 にする。
 */
export default function PreviewIndex() {
  if (process.env.NODE_ENV === "production") notFound();

  const groups = Object.keys(previewGroups) as PreviewGroup[];
  return (
    <main className="mx-auto flex max-w-160 flex-col gap-8 px-4 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight text-text">dev preview</h1>
        <p className="text-sm leading-relaxed text-text-secondary">
          docs/ui/screenshots/ の画面をモックデータで再現したもの。名前はスクリーンショットのファイル名と同じ。
          モバイルの画面はブラウザの幅を 768px 未満（スクリーンショットは 390px）にして見る。
        </p>
      </header>
      {groups.map((group) => (
        <section key={group} className="flex flex-col gap-2">
          <h2 className="text-sm font-bold text-text">{previewGroups[group]}</h2>
          <ul className="rounded-md border border-border bg-surface">
            {previewCatalog
              .filter((entry) => previewGroupOf(entry) === group)
              .map((entry, index) => (
                <li key={entry.name} className={index > 0 ? "border-t border-border" : undefined}>
                  <Link
                    href={`/dev/preview/${entry.name}`}
                    className="flex items-center justify-between gap-3 px-3.5 py-2.5 hover:bg-surface-muted"
                  >
                    <span className="text-base text-text">{entry.title}</span>
                    <span className="font-mono text-2xs text-text-muted">{entry.name}</span>
                  </Link>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
