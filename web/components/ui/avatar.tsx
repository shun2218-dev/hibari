"use client";

import { useState } from "react";

import { type AvatarColor, avatarColor, avatarInitial } from "@/lib/avatar";
import { type PresenceView, presenceLabel } from "@/lib/chat/presence";
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
 * - photo: プロフィールのパネルの写真。置き場所の幅いっぱいの正方形（上限は呼ぶ側が `max-w-*` で決める）。
 *   Slack と同じく、パネルの高さの 1/3〜1/2 ほどを占める大きさにする（ADR 0050 決定 6 の追記）
 */
export type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl" | "message" | "photo";

const sizeClass: Record<AvatarSize, string> = {
  xs: "size-6.5 text-2xs",
  sm: "size-8 text-sm",
  md: "size-9 text-base",
  lg: "size-10 text-lg",
  xl: "size-14 text-xl",
  message: "size-8 text-sm md:size-10 md:text-lg",
  photo: "aspect-square w-full text-avatar",
};

type AvatarProps = {
  /** 色を決める不変の ID（ユーザー ID / ワークスペース ID）。 */
  id: string;
  name: string;
  /**
   * 画像の URL（署名付き。ADR 0020）。設定していない人や、読み込みに失敗したときは頭文字に戻す。
   * 期限切れの URL でも画面が崩れないよう、失敗したら黙って頭文字にする。
   */
  imageUrl?: string;
  size?: AvatarSize;
  /**
   * ユーザーは円、ワークスペースは角丸の四角にする（同じ頭文字でも人と場所を見分けられるように）。
   */
  shape?: "circle" | "square";
  /**
   * presence のドット（ADR 0049）。オンラインは緑、離席は色なしのアウトライン、オフラインはドットを出さない。
   * 自動の状態と本人の手動の離席を合わせた結果を受け取る（合わせるのは `lib/chat/presence.ts`）。
   */
  presence?: PresenceView;
  className?: string;
};

export function Avatar({ id, name, imageUrl, size = "lg", shape = "circle", presence = "offline", className }: AvatarProps) {
  // 読み込めなかった URL。取り直して URL が変われば、もう一度画像を試す（ADR 0028）
  const [failedUrl, setFailedUrl] = useState<string>();
  const radius = shape === "circle" ? "rounded-full" : size === "xl" || size === "photo" ? "rounded-lg" : "rounded-sm";
  return (
    <span className={cx("relative inline-flex shrink-0", className)}>
      {imageUrl && imageUrl !== failedUrl ? (
        // 署名付き URL は短命で、next/image の最適化（サーバー経由の取得）も使えないので img を使う
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt=""
          onError={() => setFailedUrl(imageUrl)}
          className={cx("object-cover", sizeClass[size], radius)}
        />
      ) : (
        <span
          aria-hidden
          className={cx(
            "inline-flex items-center justify-center font-semibold text-on-avatar select-none",
            colorClass[avatarColor(id)],
            sizeClass[size],
            radius,
          )}
        >
          {avatarInitial(name)}
        </span>
      )}
      {presence !== "offline" && <PresenceDot presence={presence} className="absolute right-0 bottom-0" />}
    </span>
  );
}

/**
 * presence のドット（ADR 0049）。アバターの右下に重ねるほか、プロフィールのパネルでは文言の前に置く
 * （写真が大きいと、隅のドットが写真から離れて見えるため）。オフラインは呼ぶ側で出さない。
 */
export function PresenceDot({ presence, className }: { presence: Exclude<PresenceView, "offline">; className?: string }) {
  return (
    <span
      role="img"
      aria-label={presenceLabel[presence]}
      className={cx(
        "inline-block size-2 shrink-0 rounded-full ring-2 ring-surface",
        // 離席は「色を持たない」ことで、いま起きていること（オンライン）と見分ける。中身は地と同じ色で抜く
        presence === "online" ? "bg-online" : "border-2 border-text-muted bg-surface",
        className,
      )}
    />
  );
}
