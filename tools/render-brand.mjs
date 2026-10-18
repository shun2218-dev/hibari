#!/usr/bin/env node
// ブランドの画像を docs/ui/brand/ のもとから書き出す（ADR 0063 決定 3 / 4）。
//
//   make brand
//
// - web/app/icon.svg             ← docs/ui/brand/mark.svg をそのまま写す（ファビコン。丸なし）
// - web/public/icon-activity.svg ← docs/ui/brand/mark-activity.svg（アクティビティがあるときに差し替えるファビコン）
// - web/app/apple-icon.png       ← mark.svg を 180x180 で撮る。iOS は透明な角を黒く塗るので、角も緑で埋める
// - web/app/favicon.ico          ← mark.svg を 32x32 で撮り、PNG をそのまま ICO に包む（SVG を読めないブラウザ向け。丸は付けない）
// - web/app/opengraph-image.png  ← docs/ui/brand/ogp.html を 1200x630 で撮る
//
// 画像は headless Chrome で撮る（tools/shoot-ui.mjs と同じ。画像の変換の道具をホストに入れなくてよい）。
// 生成したファイルもコミットする。デザインを変えたら、もとを直してから書き出し直す。
import { execFile } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BRAND = path.join(ROOT, "docs/ui/brand");
const WEB = path.join(ROOT, "web");
/** 書体（Google Fonts）の読み込みを待つ時間。 */
const FONT_BUDGET_MS = 5_000;

const run = promisify(execFile);

/** HTML のファイルを、指定した大きさの PNG に撮る。透明にしたいときは transparent を付ける。 */
async function screenshot(htmlPath, width, height, { transparent = false } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "hibari-brand-"));
  const out = path.join(dir, "shot.png");
  try {
    await run(CHROME, [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      `--window-size=${width},${height}`,
      `--virtual-time-budget=${FONT_BUDGET_MS}`,
      ...(transparent ? ["--default-background-color=00000000"] : []),
      `--screenshot=${out}`,
      pathToFileURL(htmlPath).href,
    ]);
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** SVG を大きさいっぱいに描く HTML を作って撮る。 */
async function screenshotSVG(svgPath, size, { background } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "hibari-brand-"));
  const html = path.join(dir, "icon.html");
  const svg = await readFile(svgPath, "utf8");
  await writeFile(
    html,
    `<!doctype html><html><head><style>html,body{margin:0;background:${background ?? "transparent"}}svg{display:block;width:${size}px;height:${size}px}</style></head><body>${svg}</body></html>`,
  );
  try {
    return await screenshot(html, size, size, { transparent: background === undefined });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** PNG を 1 枚だけ含む ICO を作る（ICO は PNG をそのまま入れられる）。 */
function icoFromPNG(png, size) {
  const header = Buffer.alloc(6 + 16);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // count
  header.writeUInt8(size, 6); // width
  header.writeUInt8(size, 7); // height
  header.writeUInt8(0, 8); // palette
  header.writeUInt8(0, 9); // reserved
  header.writeUInt16LE(1, 10); // planes
  header.writeUInt16LE(32, 12); // bits per pixel
  header.writeUInt32LE(png.length, 14); // size
  header.writeUInt32LE(header.length, 18); // offset
  return Buffer.concat([header, png]);
}

await copyFile(path.join(BRAND, "mark.svg"), path.join(WEB, "app/icon.svg"));
await copyFile(path.join(BRAND, "mark-activity.svg"), path.join(WEB, "public/icon-activity.svg"));
await writeFile(path.join(WEB, "app/apple-icon.png"), await screenshotSVG(path.join(BRAND, "mark.svg"), 180, { background: "#2f6f62" }));
await writeFile(path.join(WEB, "app/favicon.ico"), icoFromPNG(await screenshotSVG(path.join(BRAND, "mark.svg"), 32), 32));
await writeFile(path.join(WEB, "app/opengraph-image.png"), await screenshot(path.join(BRAND, "ogp.html"), 1200, 630));
console.log("wrote web/app/{icon.svg,apple-icon.png,favicon.ico,opengraph-image.png} and web/public/icon-activity.svg");
