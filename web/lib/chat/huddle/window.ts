/**
 * ハドルのタブ（ADR 0066 追記 C）。チャットのタブが about:blank のタブを開き、React の portal でそこに描く。
 *
 * 中身を読み込まないタブなので、スタイルシート・テーマ（data-theme）・フォントのクラス・アイコンはチャットのタブから写す。
 * マイクと接続はチャットのタブが持つので、このタブを閉じてもハドルからは抜けない（帯に戻る）。
 */

/** 同じ名前で開くと、開いているタブを使い回す（2 つ開かない）。 */
const WINDOW_NAME = "hibari-huddle";
/** 閉じられたかを確かめる間隔。pagehide が来ないブラウザ（閉じ方）があるので、見張りを重ねる。 */
const CLOSED_POLL_MS = 1_000;

export type HuddleWindow = {
  /** portal の描き先。 */
  container: HTMLElement;
  setTitle(title: string): void;
  focus(): void;
  close(): void;
};

/**
 * タブを開く。ブラウザが止めた（ポップアップのブロック）ら null。
 * ボタンを押した操作の中で呼ぶこと（操作をきっかけにしない window.open はブロックされる）。
 */
export function openHuddleWindow(opener: Window, { onClose }: { onClose: () => void }): HuddleWindow | null {
  const w = opener.open("about:blank", WINDOW_NAME);
  if (!w) return null;
  const doc = w.document;
  // 使い回したタブ（前の描画が残っている）も、まっさらにしてから描く
  doc.open();
  doc.write("<!doctype html><html><head></head><body></body></html>");
  doc.close();
  copyAppearance(opener.document, doc);

  const container = doc.createElement("div");
  doc.body.appendChild(container);

  // テーマを切り替えたら、ハドルのタブにも写す
  const themeObserver = new MutationObserver(() => copyRootAttributes(opener.document, doc));
  themeObserver.observe(opener.document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });

  let closed = false;
  function finish() {
    if (closed) return;
    closed = true;
    themeObserver.disconnect();
    opener.clearInterval(poll);
    onClose();
  }
  w.addEventListener("pagehide", finish);
  const poll = opener.setInterval(() => {
    if (w.closed) finish();
  }, CLOSED_POLL_MS);

  return {
    container,
    setTitle(title) {
      doc.title = title;
    },
    focus() {
      w.focus();
    },
    close() {
      finish();
      w.close();
    },
  };
}

function copyAppearance(from: Document, to: Document) {
  copyRootAttributes(from, to);
  to.documentElement.lang = from.documentElement.lang;
  to.body.className = from.body.className;
  for (const node of from.head.querySelectorAll('link[rel="stylesheet"], style, link[rel~="icon"]')) {
    const clone = node.cloneNode(true) as HTMLElement;
    // 相対の URL は about:blank からは解決できないので、絶対の URL にする
    if (clone instanceof HTMLLinkElement) clone.href = (node as HTMLLinkElement).href;
    to.head.appendChild(to.importNode(clone, true));
  }
  const viewport = to.createElement("meta");
  viewport.name = "viewport";
  viewport.content = "width=device-width, initial-scale=1";
  to.head.appendChild(viewport);
}

function copyRootAttributes(from: Document, to: Document) {
  to.documentElement.className = from.documentElement.className;
  const theme = from.documentElement.getAttribute("data-theme");
  if (theme === null) to.documentElement.removeAttribute("data-theme");
  else to.documentElement.setAttribute("data-theme", theme);
}
