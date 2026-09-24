import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LandingPage } from "./landing-page";

const APP = new URL("https://app.hibari-chat.com");

describe("LandingPage", () => {
  it("最初の見出しに説明と同じ言葉を出す", () => {
    render(<LandingPage appBaseUrl={APP} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "ワークスペースとチャンネルで話す、リアルタイムチャット。",
    );
  });

  it("ログインとアカウント作成はアプリのホストへ移る", () => {
    render(<LandingPage appBaseUrl={APP} />);
    for (const link of screen.getAllByRole("link", { name: "ログイン" })) {
      expect(link.getAttribute("href")).toBe("https://app.hibari-chat.com/login");
    }
    expect(screen.getByRole("link", { name: "アカウントを作成" }).getAttribute("href")).toBe(
      "https://app.hibari-chat.com/signup",
    );
    expect(screen.getByRole("link", { name: "はじめる" }).getAttribute("href")).toBe(
      "https://app.hibari-chat.com/signup",
    );
  });

  it("機能を 6 つ並べる", () => {
    render(<LandingPage appBaseUrl={APP} />);
    const features = screen.getByRole("heading", { name: "チャットに要るものを、ひととおり" }).nextElementSibling;
    expect(within(features as HTMLElement).getAllByRole("listitem")).toHaveLength(6);
  });

  it("ドキュメントと GitHub へのリンクを出す", () => {
    render(<LandingPage appBaseUrl={APP} />);
    expect(screen.getByRole("link", { name: "ドキュメントを読む" }).getAttribute("href")).toBe(
      "https://docs.hibari-chat.com",
    );
    const footer = screen.getByRole("navigation", { name: "フッター" });
    expect(within(footer).getByRole("link", { name: "GitHub" }).getAttribute("href")).toBe(
      "https://github.com/shun2218-dev/hibari",
    );
  });
});
