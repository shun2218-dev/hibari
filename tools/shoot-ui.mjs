#!/usr/bin/env node
// docs/ui/screenshots/ の PNG を Storybook から撮り直す（ADR 0047）。
//
//   npm --prefix web run storybook          # 撮影のもとになる Storybook を起動する
//   make web-shots                          # source: "app" の PNG を全部撮り直す
//   make web-shots names="chat/room-header-settings chat/mobile-room"
//
// - 撮るのは `screenshot` の tag が付いた story だけ（部品の story は撮らない。ADR 0047 決定 12）。
// - 名前は PNG のパスそのもの。story の id の `--` より前がディレクトリで、`-` で区切る
//   （`chat-thread--panel-empty` ↔ `chat/thread/panel-empty.png`。ADR 0047 決定 2）。
// - 撮る大きさと出どころは story の `parameters.screenshot` にある。index.json には parameters が載らないので、
//   描画したページの `<html data-shot-size / data-shot-source>`（.storybook/preview.tsx の decorator が書く）から読む。
// - headless Chrome の `--window-size --screenshot` は、幅が狭いときにレイアウトが崩れた（横に伸びる要素が縮まない）ので、
//   DevTools Protocol で Emulation.setDeviceMetricsOverride を使って撮る。
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE_URL = process.env.BASE_URL ?? "http://localhost:6006";
const PORT = Number(process.env.CDP_PORT ?? 9333);
const OUT_DIR = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), "docs/ui/screenshots");
/** 画面の描画とフォントの読み込みを待つ時間。 */
const SETTLE_MS = 2_000;
/** 大きさを読むまでの待ち方（decorator が <html> に書くのを待つ）。 */
const POLL_MS = 100;
const POLL_MAX = 100;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** story の id を PNG のパスにする（`chat-thread--panel-empty` → `chat/thread/panel-empty`）。 */
const screenshotName = (id) => {
  const [dirs, story] = id.split("--");
  return [...dirs.split("-"), story].join("/");
};

const index = await fetch(`${BASE_URL}/index.json`)
  .then((r) => (r.ok ? r.json() : null))
  .catch(() => null);
if (!index) {
  console.error(`Storybook が ${BASE_URL} にいない（npm --prefix web run storybook で起動する）`);
  process.exit(1);
}

/**
 * PNG のパス（`chat/attachment/image-viewer`）→ story の id（`chat-attachment--image-viewer`）。
 *
 * `screenshot` の tag が付いた story だけが「画面」で、PNG と 1 対 1 に対応する（ADR 0047 決定 12）。
 * 部品の story（components/ 以下）はここに入れない。
 */
const stories = new Map(
  Object.values(index.entries)
    .filter((entry) => entry.type === "story" && entry.tags?.includes("screenshot"))
    .map((entry) => [screenshotName(entry.id), entry.id]),
);

const asked = process.argv.slice(2);
for (const name of asked) {
  if (!stories.has(name)) {
    console.error(`story がない: ${name}（名前は docs/ui/screenshots/ のパスと同じ）`);
    process.exit(2);
  }
}
// 名前を渡さなければ全部撮る（実際に撮るかは source が app かどうかで決める。下の shoot）
const targets = asked.length > 0 ? asked : [...stories.keys()].sort();

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
  for (const name of targets) {
    await shoot(socket, name);
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

/**
 * 動くものを止める。入力中の「…」のように動き続けるものは、撮るたびに違う瞬間が写ってしまう。
 * 途中で止めると「いつ止めたか」で結果が変わるので、最初から動かさない（読み込みの前に仕込む）。
 */
async function stopAnimations(send, sessionId) {
  const css = "*, *::before, *::after { animation: none !important; transition: none !important; }";
  await send(
    "Page.addScriptToEvaluateOnNewDocument",
    {
      source: `document.addEventListener("DOMContentLoaded", () => {
        const style = document.createElement("style");
        style.textContent = ${JSON.stringify(css)};
        document.head.append(style);
      });`,
    },
    sessionId,
  );
}

/**
 * 画像と書体の読み込みが終わるまで待つ。終わる前に撮ると、タイムラインの高さが変わって
 * スクロールの位置（＝スクロールバーの位置）が撮るたびに変わる。
 */
async function settle(send, sessionId) {
  const ready = `document.readyState === "complete"
    && document.fonts.status === "loaded"
    && [...document.images].every((img) => img.complete)`;
  for (let attempt = 0; attempt < POLL_MAX; attempt++) {
    const { result } = await send("Runtime.evaluate", { expression: ready, returnByValue: true }, sessionId);
    if (result.value) break;
    await wait(POLL_MS);
  }
  // 読み込みのあとの再描画（スクロールの当て直しなど）を待つ。
  await wait(SETTLE_MS);
}

/** 描画された story から、撮影の指定（大きさと出どころ）を読む。 */
async function readShotParams(send, sessionId) {
  for (let attempt = 0; attempt < POLL_MAX; attempt++) {
    const { result } = await send(
      "Runtime.evaluate",
      { expression: "JSON.stringify(document.documentElement.dataset)", returnByValue: true },
      sessionId,
    );
    const data = JSON.parse(result.value ?? "{}");
    if (data.shotSize) return { size: data.shotSize, source: data.shotSource ?? "app" };
    await wait(POLL_MS);
  }
  throw new Error("story が描画されない（data-shot-size が付かない）");
}

async function shoot({ send }, name) {
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  try {
    await send("Page.enable", {}, sessionId);
    await stopAnimations(send, sessionId);
    // 読みに行くだけの 1 回目。大きさが分かってから当て直す。
    await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, sessionId);
    const url = `${BASE_URL}/iframe.html?id=${stories.get(name)}&viewMode=story`;
    await send("Page.navigate", { url }, sessionId);
    const { size, source } = await readShotParams(send, sessionId);
    if (source !== "app") {
      console.log(`${name} -> 撮らない（source: ${source}。Claude Design から取り込んだ PNG）`);
      return;
    }
    const [width, height] = size.split("x").map(Number);
    if (!width || !height) throw new Error(`大きさの形が違う: ${size}`);
    // 大きさを当ててから読み込み直す。あとから広さを変えるだけだと、
    // 初回の描画のときのスクロール位置（タイムラインの末尾）がずれたまま残る。
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
    await send("Page.navigate", { url }, sessionId);
    await settle(send, sessionId);
    const { data } = await send("Page.captureScreenshot", { format: "png" }, sessionId);
    const file = path.join(OUT_DIR, `${name}.png`);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, Buffer.from(data, "base64"));
    console.log(`${name} -> ${path.relative(process.cwd(), file)} (${size})`);
  } finally {
    await send("Target.closeTarget", { targetId });
  }
}
