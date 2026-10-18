/** Crockford の Base32（I・L・O・U を除く）。 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const TIME_LENGTH = 10;
const RANDOM_LENGTH = 16;

/**
 * ULID（26 文字）を作る。送信の client_msg_id に使う（ADR 0004）。
 *
 * Go の oklog/ulid が読める形（先頭 48 ビットがミリ秒の時刻、残り 80 ビットが乱数）にする。
 * 冪等性の判定に使うだけで並びの根拠にはしない（順序は seq。CLAUDE.md ルール 3）ので、同じミリ秒の中で単調増加させる必要はない。
 * 1 つの値のためにライブラリを入れず、乱数は crypto.getRandomValues から取る。
 */
export function ulid(
  now: number = Date.now(),
  randomBytes: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n)),
): string {
  let time = "";
  // 48 ビットはビット演算（32 ビット）に収まらないので、割り算で 5 ビットずつ取り出す
  let rest = now;
  for (let i = 0; i < TIME_LENGTH; i++) {
    time = ALPHABET[rest % 32] + time;
    rest = Math.floor(rest / 32);
  }

  // 1 バイトの乱数の下位 5 ビットを 1 文字にする（256 は 32 で割り切れるので偏らない）
  const bytes = randomBytes(RANDOM_LENGTH);
  let random = "";
  for (let i = 0; i < RANDOM_LENGTH; i++) random += ALPHABET[bytes[i] & 31];
  return time + random;
}
