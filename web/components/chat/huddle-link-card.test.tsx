import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { HuddleLinkCard } from "./huddle-link-card";
import type { HuddleLinkCardView } from "./types";

const naoki = { id: "u-naoki", name: "佐藤 直樹" };
const miyuki = { id: "u-miyuki", name: "高橋 みゆき" };

function ok(overrides: Partial<Extract<HuddleLinkCardView, { state: "ok" }>> = {}): HuddleLinkCardView {
  return { key: "hl-1", state: "ok", room: { kind: "public", name: "雑談" }, huddle: null, canJoin: true, ...overrides };
}

describe("HuddleLinkCard（ADR 0067 決定 2）", () => {
  it("進行中でなければ、Slack と同じく「ハドルミーティングを開始する」を出す", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<HuddleLinkCard card={ok()} onOpen={onOpen} />);

    const card = screen.getByRole("article", { name: "ハドルミーティングのリンク" });
    expect(within(card).getByText("ハドルミーティングのリンクが共有されました")).toBeInTheDocument();
    expect(within(card).getByText("雑談")).toBeInTheDocument();
    expect(within(card).queryByText("ライブ")).not.toBeInTheDocument();
    await user.click(within(card).getByRole("button", { name: "ハドルミーティングを開始する" }));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("進行中は「ライブ」と人数、「参加する」を出す", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<HuddleLinkCard card={ok({ huddle: { participants: [naoki, miyuki], joined: false } })} onOpen={onOpen} />);

    expect(screen.getByText("ライブ")).toBeInTheDocument();
    expect(screen.getByText("2 人が参加中")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "参加する" }));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("自分が入っていれば「参加中」で、押すとハドルの画面を前に出す", async () => {
    const user = userEvent.setup();
    const onShowScreen = vi.fn();
    render(<HuddleLinkCard card={ok({ huddle: { participants: [naoki], joined: true } })} onShowScreen={onShowScreen} />);

    expect(screen.queryByRole("button", { name: "参加する" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "参加中" }));
    expect(onShowScreen).toHaveBeenCalledOnce();
  });

  it.each([
    { name: "進行中でない", huddle: null },
    { name: "進行中", huddle: { participants: [naoki], joined: false } },
  ])("入れない人（$name）にはボタンを出さない", ({ huddle }) => {
    render(<HuddleLinkCard card={ok({ huddle, canJoin: false })} />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("別のワークスペースなら、ワークスペースの名前を添える", () => {
    render(<HuddleLinkCard card={ok({ workspaceName: "メモ" })} />);

    expect(screen.getByText("メモ /")).toBeInTheDocument();
  });

  it("読めないリンクは、場所を出さずに「アクセスできないハドルミーティング」にする", () => {
    render(<HuddleLinkCard card={{ key: "hl-1", state: "unavailable" }} />);

    expect(screen.getByText("アクセスできないハドルミーティング")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
