import { type AvatarColor, avatarColor, avatarInitial } from "@/lib/avatar";
import { cx } from "@/lib/cx";

// Tailwind はソース中の完全なクラス名しか生成しないので、番号から組み立てずに対応表で持つ
const colorClass: Record<AvatarColor, string> = {
  1: "bg-avatar-1",
  2: "bg-avatar-2",
  3: "bg-avatar-3",
  4: "bg-avatar-4",
  5: "bg-avatar-5",
  6: "bg-avatar-6",
};

/**
 * - xs: 26px（管理画面のフッター）
 * - sm: 32px（メンバーパネル・招待者）
 * - md: 36px（DM 一覧・メンバー一覧）
 * - lg: 40px（メッセージ）
 * - xl: 56px（プロフィール・招待のワークスペース）
 * - message: メッセージ。モバイルでは本文の幅を確保するため 32px、md 以上で 40px
 */
export type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl" | "message";

const sizeClass: Record<AvatarSize, string> = {
  xs: "size-6.5 text-2xs",
  sm: "size-8 text-sm",
  md: "size-9 text-base",
  lg: "size-10 text-lg",
  xl: "size-14 text-xl",
  message: "size-8 text-sm md:size-10 md:text-lg",
};

type AvatarProps = {
  /** 色を決める不変の ID（ユーザー ID / ワークスペース ID）。 */
  id: string;
  name: string;
  size?: AvatarSize;
  /**
   * ユーザーは円、ワークスペースは角丸の四角にする（同じ頭文字でも人と場所を見分けられるように）。
   */
  shape?: "circle" | "square";
  /** presence。オンラインのときだけドットを出す（離席やオフラインの表示はしない）。 */
  online?: boolean;
  className?: string;
};

export function Avatar({ id, name, size = "lg", shape = "circle", online = false, className }: AvatarProps) {
  return (
    <span className={cx("relative inline-flex shrink-0", className)}>
      <span
        aria-hidden
        className={cx(
          "inline-flex items-center justify-center font-semibold text-on-avatar select-none",
          colorClass[avatarColor(id)],
          sizeClass[size],
          shape === "circle" ? "rounded-full" : size === "xl" ? "rounded-lg" : "rounded-sm",
        )}
      >
        {avatarInitial(name)}
      </span>
      {online && (
        <span
          role="img"
          aria-label="オンライン"
          className="absolute right-0 bottom-0 size-2 rounded-full bg-online ring-2 ring-surface"
        />
      )}
    </span>
  );
}
