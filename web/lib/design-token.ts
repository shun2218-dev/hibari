/**
 * globals.css から、ライトのテーマの色トークンの値を読む（CLAUDE.md ルール 7。トークンの正本は globals.css の CSS 変数だけ）。
 *
 * CSS 変数を読めない出力（Web App Manifest の色）のために使う。値を写して持つと、トークンを変えたときに食い違う。
 * ライトの値は `@theme static { … }` に、ダークは `[data-theme="dark"]` の上書きにあるので、@theme の中だけを見る。
 */
export function lightColorToken(css: string, name: `--color-${string}`): string {
  const start = css.indexOf("@theme static {");
  if (start === -1) throw new Error("@theme static block not found");
  const end = css.indexOf("\n}", start);
  const theme = css.slice(start, end === -1 ? undefined : end);
  const value = new RegExp(`(?:^|\\s)${name}:\\s*([^;]+);`, "u").exec(theme)?.[1]?.trim();
  if (!value) throw new Error(`color token not found: ${name}`);
  return value;
}
