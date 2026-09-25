"use client";

import { type ReactNode, useRef } from "react";

import { ResizeHandle } from "@/components/ui/resize-handle";
import { cx } from "@/lib/cx";

type ChatLayoutProps = {
  /** 画面のいちばん上に置く全幅の帯（`TopBar`。ADR 0061）。 */
  topBar?: ReactNode;
  /** 渡さなければサイドバーの列ごと出さない（検索結果の画面。Slack と同じく全幅で使う）。 */
  sidebar?: ReactNode;
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
  /**
   * 入っているハドルの窓（ADR 0066 決定 17）。md 以上はサイドバーの下（Slack の「サイドバーのハドルウィンドウ」）、
   * モバイルは一覧とルームのどちらを見ていても見えるよう、上の帯の下に全幅で出す。
   */
  huddle?: { window: ReactNode; mobileBar: ReactNode };
};

export function ChatLayout({ topBar, sidebar, rail, tabBar, children, panel, mobileView, huddle }: ChatLayoutProps) {
  const sidebarRef = useRef<HTMLDivElement>(null);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-surface">
      {topBar}
      {huddle && <div className="md:hidden">{huddle.mobileBar}</div>}
      <div className="relative flex min-h-0 flex-1">
        {rail && <div className="hidden md:flex">{rail}</div>}
        {sidebar !== undefined && (
      <div
        ref={sidebarRef}
        className={cx(
          // 幅は md 以上でだけユーザーが変えられる（ADR 0048）。モバイルは全画面のまま
          "absolute inset-0 transition duration-280 ease-slide md:relative md:visible md:pane-sidebar md:shrink-0 md:border-r md:border-border",
          mobileView === "room" && "invisible",
          (tabBar !== undefined || huddle !== undefined) && "flex flex-col",
        )}
      >
        {tabBar !== undefined || huddle !== undefined ? (
          <>
            <div className="min-h-0 flex-1">{sidebar}</div>
            {huddle && <div className="hidden md:block">{huddle.window}</div>}
            {tabBar !== undefined && <div className="md:hidden">{tabBar}</div>}
          </>
        ) : (
          sidebar
        )}
        <ResizeHandle pane="sidebar" grow="right" measure={sidebarRef} />
      </div>
        )}
        <main
          className={cx(
            "absolute inset-0 flex min-w-0 flex-col bg-surface transition duration-280 ease-slide md:visible md:static md:flex-1 md:translate-x-0",
            // サイドバーがなければ、モバイルでも隠す相手がいないので常に見せる
            sidebar !== undefined && mobileView === "list" && "invisible translate-x-full",
          )}
        >
          {children}
        </main>
        {panel}
      </div>
    </div>
  );
}
