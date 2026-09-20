import { readdirSync } from "node:fs";
import path from "node:path";

import { composeStories } from "@storybook/react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import * as authStories from "./auth.stories";
import * as chatStories from "./chat.stories";
import * as inviteStories from "./invite.stories";
import * as settingsStories from "./settings.stories";
import * as workspaceStories from "./workspace.stories";

/**
 * story と docs/ui/screenshots/ の PNG の対応を保つ検査（ADR 0047 決定 6）。
 * `/dev/preview` にあった catalog.test.tsx を、そのまま story 側に移したもの。
 */

/** 絞り込みに出すフェーズ。新しいフェーズの画面を足したら、ここにも足す。 */
const phases = ["1.5", "6-1", "6-2", "6", "6.4", "6.5", "6.6", "6.7", "6.7.5", "6.11", "6.13"];

// composeStories はモジュールごとに型が付くので、まとめてから flatMap にはしない。
const stories = [
  ...Object.values(composeStories(authStories)),
  ...Object.values(composeStories(chatStories)),
  ...Object.values(composeStories(inviteStories)),
  ...Object.values(composeStories(settingsStories)),
  ...Object.values(composeStories(workspaceStories)),
];

/** story の id（`chat--image-viewer`）を PNG のパス（`chat/image-viewer`）にする。 */
function screenshotName(id: string): string {
  return id.replace("--", "/");
}

// docs/ui/screenshots/ の PNG を「グループ/名前」の形で集める
function screenshotNames(): string[] {
  const root = path.join(import.meta.dirname, "../../docs/ui/screenshots");
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((dir) =>
      readdirSync(path.join(root, dir.name))
        .filter((file) => file.endsWith(".png"))
        .map((file) => `${dir.name}/${file.replace(/\.png$/, "")}`),
    )
    .sort();
}

describe("画面の story", () => {
  const names = stories.map((story) => screenshotName(story.id));

  it("docs/ui のスクリーンショット 1 枚につき story が 1 つある", () => {
    expect([...names].sort()).toEqual(screenshotNames());
  });

  it("同じ id の story がない", () => {
    expect(new Set(names).size).toBe(names.length);
  });

  it("ダークとモバイルは、名前と parameters が合っている", () => {
    for (const story of stories) {
      const name = screenshotName(story.id);
      const dark = story.parameters.theme === "dark";
      const mobile = story.parameters.screenshot?.size === "390x844";
      expect(dark, name).toBe(name.endsWith("-dark"));
      expect(mobile, name).toBe(name.split("/")[1].startsWith("mobile-"));
      // モバイルは Storybook 上でも 390px で見えるようにする（撮影は data-shot-size を見る）
      if (mobile) expect(story.globals.viewport, name).toEqual({ value: "mobile" });
    }
  });

  it("どの story にも、絞り込みに出るフェーズの tag が 1 つある", () => {
    for (const story of stories) {
      const since = story.tags.filter((tag) => tag.startsWith("since:"));
      expect(since, screenshotName(story.id)).toHaveLength(1);
      expect(phases, screenshotName(story.id)).toContain(since[0].slice("since:".length));
    }
  });

  it("撮影の出どころは app か design のどちらか", () => {
    for (const story of stories) {
      const source = story.parameters.screenshot?.source ?? "app";
      expect(["app", "design"], screenshotName(story.id)).toContain(source);
    }
  });

  it.each(stories.map((story) => [screenshotName(story.id), story] as const))("%s を描ける", (_name, Story) => {
    const { container } = render(<Story />);

    const root = container.firstElementChild!;
    expect(root.childElementCount).toBeGreaterThan(0);
    if (Story.parameters.theme === "dark") expect(root).toHaveAttribute("data-theme", "dark");
    else expect(root).not.toHaveAttribute("data-theme");
    // どの画面にも見出しかフォーム操作がある（空の描画になっていない）
    expect(screen.queryAllByRole("heading").length + screen.queryAllByRole("button").length).toBeGreaterThan(0);
  });
});
