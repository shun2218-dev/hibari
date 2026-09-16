import { readdirSync } from "node:fs";
import path from "node:path";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { previewCatalog } from "./catalog";
import { PreviewScreen, previewScreens } from "./screens";

// docs/ui/screenshots/ の PNG を「グループ/名前」の形で集める
function screenshotNames(): string[] {
  const root = path.join(import.meta.dirname, "../../../../docs/ui/screenshots");
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((dir) =>
      readdirSync(path.join(root, dir.name))
        .filter((file) => file.endsWith(".png"))
        .map((file) => `${dir.name}/${file.replace(/\.png$/, "")}`),
    )
    .sort();
}

describe("/dev/preview catalog", () => {
  const names = previewCatalog.map((entry) => entry.name);

  it("has exactly one entry per screenshot in docs/ui (6-1 DoD)", () => {
    expect([...names].sort()).toEqual(screenshotNames());
  });

  it("has no duplicate entries", () => {
    expect(new Set(names).size).toBe(names.length);
  });

  it("renders a screen for every entry", () => {
    expect(Object.keys(previewScreens).sort()).toEqual([...names].sort());
  });

  it("marks dark and mobile variants by their file names", () => {
    for (const entry of previewCatalog) {
      expect(entry.dark ?? false, entry.name).toBe(entry.name.endsWith("-dark"));
      expect(entry.mobile ?? false, entry.name).toBe(entry.name.split("/")[1].startsWith("mobile-"));
    }
  });

  it.each(previewCatalog.map((entry) => [entry.name, entry] as const))("renders %s", (_name, entry) => {
    const { container } = render(<PreviewScreen name={entry.name} dark={entry.dark ?? false} />);

    const root = container.firstElementChild!;
    expect(root.childElementCount).toBeGreaterThan(0);
    if (entry.dark) expect(root).toHaveAttribute("data-theme", "dark");
    else expect(root).not.toHaveAttribute("data-theme");
    // どの画面にも見出しかフォーム操作がある（空の描画になっていない）
    expect(screen.queryAllByRole("heading").length + screen.queryAllByRole("button").length).toBeGreaterThan(0);
  });
});
