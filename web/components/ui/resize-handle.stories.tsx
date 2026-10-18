import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useRef } from "react";

import { ResizeHandle } from "./resize-handle";

/**
 * エリアの境目をドラッグして大きさを変える取っ手（ADR 0048）。
 *
 * 普段は見えない。ポインタを乗せたときと動かしている間だけ primary の線が出る。
 * 大きさの正本は `app/globals.css` の `--pane-*` で、この部品は最小・最大の数値を持たない。
 * ダブルクリック（キーボードなら Enter）で既定に戻る。
 */
const meta = {
  title: "components/ui/ResizeHandle",
  component: ResizeHandle,
  tags: ["autodocs"],
  // 取っ手は「囲っているエリア」が無いと意味を持たないので、story はどれも render で組み立てる。
  // この args は props の表を出すためだけのもの
  args: { pane: "sidebar", grow: "right", measure: { current: null } },
  decorators: [(Story) => <div className="flex h-60 bg-background p-4">{Story()}</div>],
} satisfies Meta<typeof ResizeHandle>;

export default meta;

type Story = StoryObj<typeof meta>;

function SidebarExample() {
  const pane = useRef<HTMLDivElement>(null);
  return (
    <>
      <div ref={pane} className="pane-sidebar relative shrink-0 border-r border-border bg-surface p-3">
        <p className="text-sm text-text-secondary">サイドバー</p>
        <ResizeHandle pane="sidebar" grow="right" measure={pane} />
      </div>
      <div className="min-w-0 flex-1 p-3">
        <p className="text-sm text-text-muted">本文</p>
      </div>
    </>
  );
}

/** 左のサイドバー。境目を右へ引くと広がる。 */
export const Sidebar: Story = { name: "サイドバー（右へ引くと広がる）", render: () => <SidebarExample /> };

function PanelExample() {
  const pane = useRef<HTMLDivElement>(null);
  return (
    <>
      <div className="min-w-0 flex-1 p-3">
        <p className="text-sm text-text-muted">本文</p>
      </div>
      <div ref={pane} className="pane-members relative shrink-0 border-l border-border bg-surface p-3">
        <p className="text-sm text-text-secondary">メンバー</p>
        <ResizeHandle pane="members" grow="left" measure={pane} />
      </div>
    </>
  );
}

/** 右のパネル。境目を左へ引くと広がる。メンバー・スレッド・（今後の）プロフィールが同じ形。 */
export const Panel: Story = { name: "右のパネル（左へ引くと広がる）", render: () => <PanelExample /> };
