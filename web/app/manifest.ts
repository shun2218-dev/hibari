import { readFileSync } from "node:fs";
import path from "node:path";

import type { MetadataRoute } from "next";

import { lightColorToken } from "@/lib/design-token";
import { APP_DESCRIPTION, APP_NAME } from "@/lib/document-title";

/**
 * Web App Manifest（`/manifest.webmanifest`。ADR 0069 決定 1、ロードマップ Phase 7.1 の構築順 7）。
 *
 * iPhone / iPad の Safari は、ホーム画面に追加した hibari だけにプッシュ通知を許す。ホーム画面から開いたときに
 * standalone（Safari の枠なし）で開くには、manifest の `display: standalone` が要る。
 * ADR 0063 決定 3 で「manifest は作らない（ロードマップにないため）」としたが、7.1 でロードマップに入った。
 *
 * - アプリ（`app.`）のための manifest。LP（apex）のページは link を外す（app/lp/page.tsx）。LP をホーム画面に足しても
 *   通知は届かず、apex の `/` は LP なので、standalone で LP が開くだけになる
 * - `start_url` は `/`。ログインしていればいつものワークスペースへ、していなければログインへ移る（app/(app)/page.tsx・layout.tsx）
 * - 色は manifest では CSS 変数を使えないので、globals.css のライトの値を読んで入れる（トークンの正本は globals.css だけ。
 *   CLAUDE.md ルール 7）。このファイルは request の情報を使わないので、ビルドのときに 1 度だけ描かれる（実行時に CSS を読まない）。
 *   ダークのテーマは hibari の中の設定で、OS の設定には追従しない（CLAUDE.md「トークンの決まりごと」）ので、manifest では表せない
 * - アイコンは `make brand` が mark.svg から撮る（tools/render-brand.mjs）。iOS のホーム画面は app/apple-icon.png を使う
 */
export default function manifest(): MetadataRoute.Manifest {
  // ビルドも vitest も web/ で動く
  const css = readFileSync(path.join(process.cwd(), "app", "globals.css"), "utf8");
  // ページの地。起動の画面と、Android の上の帯を画面の地にそろえる
  const background = lightColorToken(css, "--color-background");
  return {
    id: "/",
    name: APP_NAME,
    short_name: APP_NAME,
    description: APP_DESCRIPTION,
    lang: "ja",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: background,
    theme_color: background,
    icons: [
      { src: "/manifest-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/manifest-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
