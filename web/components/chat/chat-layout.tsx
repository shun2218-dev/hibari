import type { ReactNode } from "react";

import { cx } from "@/lib/cx";

type ChatLayoutProps = {
  sidebar: ReactNode;
  children: ReactNode;
  /** 右のメンバーパネル（モバイルではシート）。 */
  panel?: ReactNode;
  /**
   * モバイル（768px 未満）で見せる側。md 以上では両方を並べるので使わない。
   *
   * 詳細は一覧の上に右からスライドして重なる。隠れた側は visibility で隠し、キーボードや読み上げで
   * 触れないようにする（`transition` は visibility も対象なので、隠すのはスライドが終わってから）。
   * inert を使わないのは、属性ではブレークポイントごとに切り替えられず、md 以上で一覧まで無効になるため。
   */
  mobileView: "list" | "room";
};

export function ChatLayout({ sidebar, children, panel, mobileView }: ChatLayoutProps) {
  return (
    <div className="relative flex h-dvh overflow-hidden bg-surface">
      <div
        className={cx(
          "absolute inset-0 transition duration-280 ease-slide md:static md:visible md:w-72 md:shrink-0 md:border-r md:border-border",
          mobileView === "room" && "invisible",
        )}
      >
        {sidebar}
      </div>
      <main
        className={cx(
          "absolute inset-0 flex min-w-0 flex-col bg-surface transition duration-280 ease-slide md:visible md:static md:flex-1 md:translate-x-0",
          mobileView === "list" && "invisible translate-x-full",
        )}
      >
        {children}
      </main>
      {panel}
    </div>
  );
}
