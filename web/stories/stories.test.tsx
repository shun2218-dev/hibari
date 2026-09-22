import { readdirSync } from "node:fs";
import path from "node:path";

import { composeStories } from "@storybook/react";
import { render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { describe, expect, it } from "vitest";

/**
 * story の検査（ADR 0047 決定 6・12）。story は 2 種類ある。
 *
 * - **画面**（`stories/*.stories.tsx`）: `screenshot` の tag を持ち、docs/ui/screenshots/ の PNG と 1 対 1。
 * - **部品**（`components/**\/*.stories.tsx`）: PNG と対にならない。`autodocs` を付けて props の表を出す。
 *
 * どちらも新しいファイルを足せば自動で検査に入る（glob で集めるため）。
 */

type ComposedStory = ComponentType & {
  id: string;
  tags: string[];
  parameters: { theme?: string; screenshot?: { size?: string; source?: string } };
  globals: { viewport?: { value?: string } };
};

function compose(modules: Record<string, unknown>): ComposedStory[] {
  return Object.values(modules).flatMap((mod) => Object.values(composeStories(mod as never)) as ComposedStory[]);
}

const screens = compose(import.meta.glob("./**/*.stories.tsx", { eager: true }));
const parts = compose(import.meta.glob("../components/**/*.stories.tsx", { eager: true }));

/** 絞り込みに出すフェーズ。新しいフェーズの画面を足したら、ここにも足す。 */
const phases = ["1.5", "6-1", "6-2", "6", "6.4", "6.5", "6.6", "6.7", "6.7.5", "6.8", "6.9", "6.10", "6.10.5", "6.11", "6.12", "6.13", "6.14"];

/**
 * story の id を PNG のパスにする（`chat-thread--panel-empty` → `chat/thread/panel-empty`）。
 * id の `--` より前がディレクトリで、`-` で区切る。**ディレクトリの名前にハイフンを使わない**のはこのため（ADR 0047 決定 2）。
 */
function screenshotName(id: string): string {
  const [dirs, story] = id.split("--");
  return [...dirs.split("-"), story].join("/");
}

// docs/ui/screenshots/ の PNG を、拡張子を外したパスの形で集める（ディレクトリの深さは問わない）
function screenshotNames(dir = "", root = path.join(import.meta.dirname, "../../docs/ui/screenshots")): string[] {
  return readdirSync(path.join(root, dir), { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? screenshotNames(path.join(dir, entry.name), root)
        : entry.name.endsWith(".png")
          ? [path.join(dir, entry.name.replace(/\.png$/, ""))]
          : [],
    )
    .sort();
}

describe("画面の story", () => {
  const names = screens.map((story) => screenshotName(story.id));

  it("docs/ui のスクリーンショット 1 枚につき story が 1 つある", () => {
    expect([...names].sort()).toEqual(screenshotNames());
  });

  it("同じ id の story がない", () => {
    expect(new Set(names).size).toBe(names.length);
  });

  it("撮影の印（screenshot の tag と parameters）がそろっている", () => {
    for (const story of screens) {
      const name = screenshotName(story.id);
      expect(story.tags, name).toContain("screenshot");
      expect(story.parameters.screenshot, name).toBeDefined();
      expect(["app", "design"], name).toContain(story.parameters.screenshot?.source ?? "app");
    }
  });

  it("ダークとモバイルは、名前と parameters が合っている", () => {
    for (const story of screens) {
      const name = screenshotName(story.id);
      const dark = story.parameters.theme === "dark";
      const mobile = story.parameters.screenshot?.size === "390x844";
      expect(dark, name).toBe(name.endsWith("-dark"));
      expect(mobile, name).toBe(name.split("/").at(-1)!.startsWith("mobile-"));
      // モバイルは Storybook 上でも 390px で見えるようにする（撮影は data-shot-size を見る）
      if (mobile) expect(story.globals.viewport, name).toEqual({ value: "mobile" });
    }
  });

  it("どの story にも、絞り込みに出るフェーズの tag が 1 つある", () => {
    for (const story of screens) {
      const since = story.tags.filter((tag) => tag.startsWith("since:"));
      expect(since, screenshotName(story.id)).toHaveLength(1);
      expect(phases, screenshotName(story.id)).toContain(since[0].slice("since:".length));
    }
  });

  it.each(screens.map((story) => [screenshotName(story.id), story] as const))("%s を描ける", (_name, Story) => {
    const { container } = render(<Story />);

    const root = container.firstElementChild!;
    expect(root.childElementCount).toBeGreaterThan(0);
    if (Story.parameters.theme === "dark") expect(root).toHaveAttribute("data-theme", "dark");
    else expect(root).not.toHaveAttribute("data-theme");
    // どの画面にも見出しかフォーム操作がある（空の描画になっていない）
    expect(screen.queryAllByRole("heading").length + screen.queryAllByRole("button").length).toBeGreaterThan(0);
  });
});

describe("部品の story", () => {
  it("1 つ以上ある", () => {
    expect(parts.length).toBeGreaterThan(0);
  });

  it("撮影の対象にしない（PNG と対にならないため）", () => {
    for (const story of parts) {
      expect(story.tags, story.id).not.toContain("screenshot");
      expect(story.parameters.screenshot, story.id).toBeUndefined();
    }
  });

  it("props の表を出す（autodocs）", () => {
    for (const story of parts) {
      expect(story.tags, story.id).toContain("autodocs");
    }
  });

  it.each(parts.map((story) => [story.id, story] as const))("%s を描ける", (_id, Story) => {
    const { container } = render(<Story />);

    // 部品は見出しもボタンも無いことがある（Avatar / Badge）ので、何か描けていることだけを見る
    expect(container.firstElementChild!.childElementCount).toBeGreaterThan(0);
  });
});
