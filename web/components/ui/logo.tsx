import { cx } from "@/lib/cx";

/**
 * hibari のマーク（さえずる雲雀の吹き出し。docs/ui/brand/mark.svg、ADR 0063）。
 *
 * 色はトークンで塗るので、ダークでは primary / on-primary の値が入れ替わり、デザインのダークのマークになる。
 * ファビコンや OGP 画像は画像なので値を書いているが（docs/ui/brand/）、画面の中ではトークンを使う。
 * 横に「hibari」の文字を並べて使うので、マーク自体は読み上げない。
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={cx("shrink-0", className)}>
      <rect width="64" height="64" rx="15" className="fill-primary" />
      <path
        className="fill-on-primary"
        d="M27 20.5C29.6 17.2 33.4 15.6 37.4 15.8L31.4 9 42 13.8C45.2 14.6 47.6 17 48.4 20.2L55.2 19.4 49.4 23.6 55 26.6 48.8 26.8C48.4 37.8 40 46 29.6 46.8L22.2 47.2 12.4 53.6 15.4 44C13.6 41 12.6 37.6 12.8 34 13.2 27.4 19.2 21.4 27 20.5Z"
      />
      <circle cx="41.4" cy="20.8" r="2" className="fill-primary" />
      <path className="fill-primary" d="M19.6 37.2C24.6 32.4 32 31 38.2 33.4 32.4 34.8 27.8 37.8 24.6 42Z" />
    </svg>
  );
}
