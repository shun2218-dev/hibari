/**
 * プッシュ通知を押したときに、Service Worker（`public/sw.js`）から届く「この URL を開いて」を受ける（ADR 0069 決定 7）。
 *
 * Service Worker の `client.navigate` はページを読み込み直すので、ハドルの通話が切れ、ストアも作り直しになる。
 * なのでまずページに頼み、ページはタブの通知と同じ移り方（ルーター。ADR 0042）で開いて、ポートで応える。
 * 応えがなければ（チャットの画面を開いていないタブ）、Service Worker がそのタブを読み込み直して開く。
 */

/** sw.js の OPEN_MESSAGE と同じ値。 */
export const OPEN_MESSAGE = "hibari:open";

type MessageEventLike = { data: unknown; ports: readonly { postMessage(message: unknown): void }[] };

export type ServiceWorkerMessages = {
  addEventListener(type: "message", listener: (event: MessageEventLike) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEventLike) => void): void;
  /** addEventListener で受けるときは、これを呼ぶまで知らせが溜められたままになる。 */
  startMessages?(): void;
};

export function listenServiceWorkerOpen(container: ServiceWorkerMessages | undefined, open: (url: string) => void): () => void {
  if (!container) return () => {};
  function onMessage(event: MessageEventLike) {
    const data = event.data as { type?: unknown; url?: unknown } | null;
    if (!data || data.type !== OPEN_MESSAGE || typeof data.url !== "string") return;
    // sw.js も確かめているが、サイトの外へ移る入口にしない
    if (!data.url.startsWith("/") || data.url.startsWith("//") || data.url.startsWith("/\\")) return;
    open(data.url);
    event.ports[0]?.postMessage("ok");
  }
  container.addEventListener("message", onMessage);
  container.startMessages?.();
  return () => container.removeEventListener("message", onMessage);
}
