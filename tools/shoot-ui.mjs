#!/usr/bin/env node
// docs/ui/screenshots/ の PNG を /dev/preview から撮り直す（Claude Design から取り込んだ画面ではなく、実装から足した画面のためのもの）。
//
//   HIBARI_SCREENSHOTS=1 npm --prefix web run dev            # 開発インジケータを消して起動する
//   make web-shots names="chat/room-header-settings:900x120"
//
// - 名前は /dev/preview のカタログ（web/app/dev/preview/catalog.ts）と同じ「グループ/名前」。
// - 大きさは既定で 1280x800、`mobile-` で始まる名前は 390x844。`名前:WxH` で変えられる（部分を切り出したフレーム用）。
// - headless Chrome の `--window-size --screenshot` は、幅が狭いときにレイアウトが崩れた（横に伸びる要素が縮まない）ので、
//   DevTools Protocol で Emulation.setDeviceMetricsOverride を使って撮る。
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const PORT = Number(process.env.CDP_PORT ?? 9333);
const OUT_DIR = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), "docs/ui/screenshots");
/** 画面の描画とフォントの読み込みを待つ時間。 */
const SETTLE_MS = 2_000;

const targets = process.argv.slice(2).map((arg) => {
  const [name, size] = arg.split(":");
  const fallback = path.basename(name).startsWith("mobile-") ? "390x844" : "1280x800";
  const [width, height] = (size ?? fallback).split("x").map(Number);
  if (!name.includes("/") || !width || !height) throw new Error(`使い方: <group/name[:WxH]> （受け取った値: ${arg}）`);
  return { name, width, height };
});
if (targets.length === 0) {
  console.error("usage: tools/shoot-ui.mjs <group/name[:WxH]>...");
  process.exit(2);
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const res = await fetch(`${BASE_URL}/dev/preview`).catch(() => null);
if (!res?.ok) {
  console.error(`開発サーバーが ${BASE_URL} にいない（HIBARI_SCREENSHOTS=1 npm --prefix web run dev で起動する）`);
  process.exit(1);
}

const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${path.join(process.env.TMPDIR ?? "/tmp", "hibari-shoot-ui")}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);
chrome.on("error", (err) => {
  console.error(`headless Chrome を起動できない（${CHROME}）: ${err.message}`);
  process.exit(1);
});

try {
  const socket = await connect();
  for (const target of targets) {
    await shoot(socket, target);
  }
} finally {
  chrome.kill();
}

async function connect() {
  for (let attempt = 0; attempt < 40; attempt++) {
    const version = await fetch(`http://127.0.0.1:${PORT}/json/version`)
      .then((r) => r.json())
      .catch(() => null);
    if (version) return openSocket(version.webSocketDebuggerUrl);
    await wait(250);
  }
  throw new Error("Chrome の DevTools につながらない");
}

function openSocket(url) {
  const ws = new WebSocket(url);
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const resolve = pending.get(message.id);
    if (!resolve) return;
    pending.delete(message.id);
    if (message.error) throw new Error(`${message.error.message}`);
    resolve(message.result);
  });
  let id = 0;
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve) => {
      const n = ++id;
      pending.set(n, resolve);
      ws.send(JSON.stringify({ id: n, method, params, sessionId }));
    });
  return new Promise((resolve) => ws.addEventListener("open", () => resolve({ send })));
}

async function shoot({ send }, { name, width, height }) {
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Page.enable", {}, sessionId);
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
  await send("Page.navigate", { url: `${BASE_URL}/dev/preview/${name}` }, sessionId);
  await wait(SETTLE_MS);
  const { data } = await send("Page.captureScreenshot", { format: "png" }, sessionId);
  const file = path.join(OUT_DIR, `${name}.png`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, Buffer.from(data, "base64"));
  await send("Target.closeTarget", { targetId });
  console.log(`${name} -> ${path.relative(process.cwd(), file)} (${width}x${height})`);
}
