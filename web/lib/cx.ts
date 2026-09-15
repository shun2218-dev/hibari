/**
 * className を条件付きで連結する。falsy な値は捨てる。
 *
 * clsx 相当だが、必要なのはこの 1 行だけなので依存を増やさない。
 * Tailwind のクラスはソースに完全な文字列として書く必要がある（動的に組み立てると生成されない）ので、
 * 呼び出し側は `cx(active && "bg-primary-subtle")` のようにクラス名をそのまま渡す。
 */
export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
