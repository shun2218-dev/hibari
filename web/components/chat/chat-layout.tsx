"use client";

import { type ReactNode, useRef } from "react";

import { ResizeHandle } from "@/components/ui/resize-handle";
import { cx } from "@/lib/cx";

type ChatLayoutProps = {
  sidebar: ReactNode;
  /** md 以上でサイドバーの左に置く縦のメニュー（`SideNavRail`。ADR 0058）。 */
  rail?: ReactNode;
  /** モバイルで一覧の下に置くタブ（`SideNavBar`）。一覧と一緒に隠れるので、ルームを開いている間は出ない。 */
  tabBar?: ReactNode;
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

export function ChatLayout({ sidebar, rail, tabBar, children, panel, mobileView }: ChatLayoutProps) {
  const sidebarRef = useRef<HTMLDivElement>(null);

  return (
    <div className="relative flex h-dvh overflow-hidden bg-surface">
      {rail && <div className="hidden md:flex">{rail}</div>}
      <div
        ref={sidebarRef}
        className={cx(
          // 幅は md 以上でだけユーザーが変えられる（ADR 0048）。モバイルは全画面のまま
          "absolute inset-0 transition duration-280 ease-slide md:relative md:visible md:pane-sidebar md:shrink-0 md:border-r md:border-border",
          mobileView === "room" && "invisible",
          tabBar !== undefined && "flex flex-col",
        )}
      >
        {tabBar !== undefined ? (
          <>
            <div className="min-h-0 flex-1">{sidebar}</div>
            <div className="md:hidden">{tabBar}</div>
          </>
        ) : (
          sidebar
        )}
        <ResizeHandle pane="sidebar" grow="right" measure={sidebarRef} />
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
