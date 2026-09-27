import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import { HuddleList } from "./huddle-list";
import type { HuddleListItemView, HuddleOngoingCardView, HuddleSuggestionView } from "./types";

const you = { id: "u-you", name: "あなた" };
const naoki = { id: "u-naoki", name: "佐藤 直樹" };
const miyuki = { id: "u-miyuki", name: "高橋 みゆき" };
const ryo = { id: "u-ryo", name: "中村 涼" };
const misaki = { id: "u-misaki", name: "田中 美咲" };

const design = { kind: "public", name: "デザインレビュー" } as const;

function ongoing(overrides: Partial<HuddleOngoingCardView> = {}): HuddleOngoingCardView {
  return { key: "room-design", room: design, elapsedLabel: "12 分", participants: [naoki, miyuki], joined: false, ...overrides };
}

const suggestion: HuddleSuggestionView = { key: "room-release", room: { kind: "private", name: "リリース準備" }, count: 3, participants: [naoki] };

function item(overrides: Partial<HuddleListItemView> = {}): HuddleListItemView {
  return {
    key: "h-1",
    href: "/w/ws/r/room-design?m=h-1",
    threadHref: "/w/ws/r/room-design?m=h-1&t=h-1",
    room: design,
    timeLabel: "23 時間前",
    durationLabel: "2 分",
    replyCount: 0,
    participants: [you, naoki],
    saved: false,
    ...overrides,
  };
}

function renderList(props: Partial<ComponentProps<typeof HuddleList>> = {}) {
  return render(<HuddleList ongoing={[]} suggestions={[]} scope="all" items={[item()]} {...props} />);
}

describe("HuddleList の進行中と提案のカード（ADR 0067 決定 6・7）", () => {
  it("入っていない進行中のハドルは「参加する」、入っていれば「参加中」を出す", async () => {
    const user = userEvent.setup();
    const onJoin = vi.fn();
    const onShowScreen = vi.fn();
    renderList({
      ongoing: [ongoing(), ongoing({ key: "dm-miyuki", room: { kind: "dm", name: "高橋 みゆき" }, joined: true })],
      onJoin,
      onShowScreen,
    });

    const live = screen.getByRole("article", { name: "デザインレビュー のハドルミーティング（進行中）" });
    expect(within(live).getByText("12 分")).toBeInTheDocument();
    expect(within(live).getByText("2 人")).toBeInTheDocument();
    await user.click(within(live).getByRole("button", { name: "参加する" }));
    expect(onJoin).toHaveBeenCalledWith("room-design");

    const joined = screen.getByRole("article", { name: "高橋 みゆき のハドルミーティング（進行中）" });
    await user.click(within(joined).getByRole("button", { name: "参加中" }));
    expect(onShowScreen).toHaveBeenCalledWith("dm-miyuki");
  });

  it("提案のカードは、過去 1 週間の回数と「開始する」を出す", async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    renderList({ suggestions: [suggestion], onStart });

    expect(screen.getByText("過去 1 週間にここで 3 回ハドルミーティングを実施しました")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "ハドルミーティングを開始する" }));
    expect(onStart).toHaveBeenCalledWith("room-release");
  });
});

describe("HuddleList の最近のハドルミーティング（ADR 0067 決定 6）", () => {
  it("行は会話のハドルのメッセージへのリンクで、返信があるときだけ「N 件の返信」をスレッドへのリンクにする", () => {
    renderList({ items: [item(), item({ key: "h-2", replyCount: 6 })] });

    const links = screen.getAllByRole("link", { name: "デザインレビュー のハドルミーティングへ移動" });
    expect(links[0]).toHaveAttribute("href", "/w/ws/r/room-design?m=h-1");
    expect(screen.getAllByRole("link", { name: /件の返信/ })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "6 件の返信" })).toHaveAttribute("href", "/w/ws/r/room-design?m=h-1&t=h-1");
    expect(screen.getAllByText("23 時間前")).toHaveLength(2);
  });

  it("「…」には、参加者を表示する・「後で」・リンクのコピーを並べ、状態で文言を変える", async () => {
    const user = userEvent.setup();
    const onToggleSave = vi.fn();
    const onCopyLink = vi.fn();
    const onShowParticipants = vi.fn();
    const { rerender } = renderList({ openMenuKey: "h-1", onToggleSave, onCopyLink, onShowParticipants });

    const menu = screen.getByRole("dialog", { name: "ハドルミーティングの操作" });
    expect(within(menu).getByText("2 人のメンバー")).toBeInTheDocument();
    await user.click(within(menu).getByRole("button", { name: "「後で」に保存" }));
    expect(onToggleSave).toHaveBeenCalledWith("h-1");
    await user.click(within(menu).getByRole("button", { name: "ハドルミーティングのリンクをコピー" }));
    expect(onCopyLink).toHaveBeenCalledWith("h-1");
    await user.click(within(menu).getByRole("button", { name: /参加者を表示する/ }));
    expect(onShowParticipants).toHaveBeenCalledWith("h-1");

    rerender(
      <HuddleList ongoing={[]} suggestions={[]} scope="all" items={[item({ saved: true })]} openMenuKey="h-1" copiedKey="h-1" />,
    );
    expect(screen.getByRole("button", { name: "「後で」から外す" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "コピーしました" })).toBeInTheDocument();
  });

  it("参加者を表示すると、参加した人の一覧を出し、押すとプロフィールを開く", async () => {
    const user = userEvent.setup();
    const onOpenProfile = vi.fn();
    renderList({ participantsKey: "h-1", onOpenProfile });

    const list = screen.getByRole("dialog", { name: "参加者" });
    expect(within(list).getByText("参加者（2 人）")).toBeInTheDocument();
    await user.click(within(list).getByRole("button", { name: "佐藤 直樹" }));
    expect(onOpenProfile).toHaveBeenCalledWith("u-naoki");
  });

  it("参加した人が多ければ、顔を 3 人までにして「+N」を添える", () => {
    renderList({ items: [item({ participants: [you, naoki, miyuki, ryo, misaki] })] });

    expect(screen.getByText("+2")).toBeInTheDocument();
  });

  it("取得中はくるくるを出す", () => {
    renderList({ items: undefined });

    expect(screen.getByText("読み込み中")).toBeInTheDocument();
  });
});

describe("HuddleList の絞り込み（ADR 0067 決定 6）", () => {
  it("範囲のプルダウンで「すべて」と「参加しなかった」を選べ、選んでいる方に印を付ける", async () => {
    const user = userEvent.setup();
    const onChangeScope = vi.fn();
    renderList({ scope: "missed", openFilter: "scope", onChangeScope });

    expect(screen.getByRole("button", { name: "参加しなかったハドルミーティング", expanded: true })).toBeInTheDocument();
    const menu = screen.getByRole("dialog", { name: "範囲" });
    expect(within(menu).getByRole("button", { name: "参加しなかったハドルミーティング" })).toHaveAttribute("aria-pressed", "true");
    await user.click(within(menu).getByRole("button", { name: "すべてのハドルミーティング" }));
    expect(onChangeScope).toHaveBeenCalledWith("all");
  });

  it("相手を選ぶと、ボタンに名前が出て、外すこともできる", async () => {
    const user = userEvent.setup();
    const onSelectPerson = vi.fn();
    renderList({ person: naoki, openFilter: "person", personOptions: [naoki, miyuki], onSelectPerson });

    expect(screen.getByRole("button", { name: "相手: 佐藤 直樹" })).toBeInTheDocument();
    const picker = screen.getByRole("dialog", { name: "相手" });
    expect(within(picker).getByRole("button", { name: "佐藤 直樹" })).toHaveAttribute("aria-pressed", "true");
    await user.click(within(picker).getByRole("button", { name: "高橋 みゆき" }));
    expect(onSelectPerson).toHaveBeenCalledWith("u-miyuki");
    await user.click(within(picker).getByRole("button", { name: "絞り込みを外す" }));
    expect(onSelectPerson).toHaveBeenLastCalledWith(undefined);
  });

  it("場所の絞り込みの候補がなければ「見つかりません」を出す", () => {
    renderList({ openFilter: "place", placeOptions: [], filterQuery: "ない" });

    expect(within(screen.getByRole("dialog", { name: "場所" })).getByText("見つかりません")).toBeInTheDocument();
  });
});

describe("HuddleList の空のとき", () => {
  it.each([
    { name: "まだ何もない", props: { items: [] }, text: "まだハドルミーティングはありません" },
    {
      name: "進行中はあるが、終わったものがない",
      props: { items: [], ongoing: [ongoing()] },
      text: "終わったハドルミーティングはまだありません",
    },
    { name: "参加しなかったものがない", props: { items: [], ongoing: [ongoing()], scope: "missed" as const }, text: "参加しなかったハドルミーティングはありません" },
    { name: "相手で絞って 0 件", props: { items: [], person: naoki }, text: "条件に合うハドルミーティングはありません" },
  ])("$name", ({ props, text }) => {
    renderList(props);

    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it("まだ何もないときも「新規ハドルミーティング」から始められる", async () => {
    const user = userEvent.setup();
    const onNew = vi.fn();
    renderList({ items: [], onNew });

    for (const button of screen.getAllByRole("button", { name: "新規ハドルミーティング" })) await user.click(button);
    expect(onNew).toHaveBeenCalledTimes(2);
  });
});
