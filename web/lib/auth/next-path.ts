/**
 * ログイン後に戻る先（`/login?next=...`）を、同じオリジンのパスだけに限る。
 *
 * `next` は URL から来るので、誰でも好きな値を入れたリンクを作れる。`https://evil.example` や
 * `//evil.example`（プロトコル相対）をそのまま router に渡すと、ログイン直後に外部のサイトへ飛ばされる（オープンリダイレクト）。
 * 文字列の形で判定せず、実際に URL として解決してオリジンを比べる（`/\evil.example` のような、ブラウザが
 * `//` と同じに読む表記も取りこぼさないように）。
 */
export function safeNextPath(next: string | string[] | undefined, fallback = "/"): string {
  if (typeof next !== "string" || !next.startsWith("/")) return fallback;

  const base = "http://hibari.invalid";
  let url: URL;
  try {
    url = new URL(next, base);
  } catch {
    return fallback;
  }
  if (url.origin !== base) return fallback;
  // ログインの画面に戻すと、ログイン済みなので行き場がなくなる。
  if (url.pathname === "/login" || url.pathname === "/signup") return fallback;
  return url.pathname + url.search + url.hash;
}
