import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_THEME, THEME_STORAGE_KEY, currentTheme, saveTheme, serverTheme, subscribeTheme, themeBootScript } from "./theme";

describe("theme", () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it("applies the theme to the document, remembers it, and tells the subscribers", () => {
    const changed = vi.fn();
    const unsubscribe = subscribeTheme(changed);

    saveTheme("dark");

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(currentTheme()).toBe("dark");
    expect(changed).toHaveBeenCalledTimes(1);

    unsubscribe();
    saveTheme("light");
    expect(changed).toHaveBeenCalledTimes(1);
    expect(currentTheme()).toBe("light");
  });

  it("still changes the look when the theme cannot be remembered", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });

    expect(() => saveTheme("dark")).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe("dark");
    setItem.mockRestore();
  });

  it("falls back to the default before anything is applied", () => {
    expect(currentTheme()).toBe(DEFAULT_THEME);
    expect(serverTheme()).toBe(DEFAULT_THEME);
  });

  it("has a boot script that applies the remembered theme before the first paint", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");

    new Function(themeBootScript)();

    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
