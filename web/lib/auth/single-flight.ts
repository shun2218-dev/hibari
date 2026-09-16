/**
 * Web Locks API のうち、ここで使う部分だけの型。テストで差し替えられるようにする。
 */
export type LockManagerLike = {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
};

/**
 * refresh を、同じタブの中でも、タブをまたいでも 1 本ずつにする。
 *
 * Refresh Token は使うたびにローテーションし、使用済みのトークンがもう一度使われると
 * family ごと失効する（猶予期間なし。ADR 0010）。同じ Cookie を持つ 2 つのタブが同時に refresh すると、
 * 後から届いた方が「再利用」と判定され、全タブがログアウトする。
 *
 * - タブの中: 実行中の Promise を共有する（401 が同時に 3 本返っても refresh は 1 回）
 * - タブの間: Web Locks で直列にする。待っていたタブは、前のタブが受け取った新しい Cookie で refresh するので、
 *   再利用にならない（fetch はレスポンスのヘッダを処理してから解決するので、ロックを放す時点で Cookie は更新済み）
 *
 * 待っていたタブも自分で 1 回ローテーションする。Access Token をタブの間で受け渡せば 1 回に減らせるが、
 * トークンを BroadcastChannel に流す経路が増えるので、そこまではしない。
 */
export function singleFlight<T>(
  name: string,
  run: () => Promise<T>,
  locks: LockManagerLike | undefined = globalThis.navigator?.locks,
): () => Promise<T> {
  let inflight: Promise<T> | undefined;

  return () => {
    inflight ??= (locks ? locks.request(name, run) : run()).finally(() => {
      inflight = undefined;
    });
    return inflight;
  };
}
