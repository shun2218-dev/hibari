import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { MessageLinkCard } from "./message-link-card";
import type { MessageLinkCardView } from "./types";

const LONG_BODY = Array.from({ length: 8 }, (_, i) => `${i + 1} 行目の本文`).join("\n");

/** 改行を含む本文をそのまま突き合わせる（既定の matcher は空白を詰めてしまう）。 */
const asIs = { normalizer: (s: string) => s };

type OkCard = Extract<MessageLinkCardView, { state: "ok" }>;

function okCard(overrides: Partial<OkCard> = {}): OkCard {
  return {
    key: "01J8ZH5K000000000000000001/01J8ZH5K000000000000000002",
    state: "ok",
    href: "https://hibari.example/w/01J8ZH5K000000000000000000/r/01J8ZH5K000000000000000001?m=01J8ZH5K000000000000000002",
    room: { kind: "public", name: "雑談" },
    sender: { id: "01J8ZH5K000000000000000003", name: "佐藤 直樹" },
    timeLabel: "10:12",
    body: "賛成です。",
    clampedBody: "賛成です。",
    clamped: false,
    attachmentCount: 0,
    inThread: false,
    ...overrides,
  };
}

describe("MessageLinkCard", () => {
  it("読めるメッセージは、ルーム・送信者・時刻・本文を出す", () => {
    render(<MessageLinkCard card={okCard()} />);

    const card = screen.getByRole("article", { name: "佐藤 直樹 のメッセージ" });
    expect(within(card).getByText("佐藤 直樹")).toBeInTheDocument();
    expect(within(card).getByText("10:12")).toBeInTheDocument();
    expect(within(card).getByText("賛成です。")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "雑談" })).toHaveAttribute("href", okCard().href);
  });

  it("読めないメッセージは、ルーム名も送信者も出さない（ADR 0040）", () => {
    render(<MessageLinkCard card={{ key: "k", state: "unavailable" }} />);

    expect(screen.getByText("このメッセージは表示できません")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
  });

  it("取得中は枠だけを置く（高さが変わってタイムラインがずれないように）", () => {
    const { container } = render(<MessageLinkCard card={{ key: "k", state: "loading" }} />);

    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    expect(container.firstElementChild).toHaveAttribute("aria-hidden");
  });

  it("今いるワークスペースと違うときだけ、ワークスペース名を添える", () => {
    render(<MessageLinkCard card={okCard({ workspaceName: "別の会社" })} />);
    expect(screen.getByRole("link", { name: "別の会社 / 雑談" })).toBeInTheDocument();
  });

  it("private のルームには鍵、スレッドの返信には印を出す", () => {
    render(<MessageLinkCard card={okCard({ room: { kind: "private", name: "役員室" }, inThread: true })} />);

    expect(screen.getByRole("link", { name: "役員室" })).toBeInTheDocument();
    expect(screen.getByText("スレッドの返信")).toBeInTheDocument();
  });

  it("dm はルーム名の代わりに相手の名前を出す", () => {
    render(<MessageLinkCard card={okCard({ room: { kind: "dm", name: "田中 美咲" } })} />);
    expect(screen.getByRole("link", { name: "田中 美咲" })).toBeInTheDocument();
  });

  it("添付があれば件数を出す（画像は出さない。ADR 0040）", () => {
    render(<MessageLinkCard card={okCard({ attachmentCount: 2 })} />);

    expect(screen.getByText("添付 2 件")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("短い本文には「すべて表示する」を出さない", () => {
    render(<MessageLinkCard card={okCard()} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("長い本文は畳み、「すべて表示する」で広げ、広げたあとも畳める", async () => {
    const user = userEvent.setup();
    render(<MessageLinkCard card={okCard({ body: LONG_BODY, clampedBody: "1 行目の本文…", clamped: true })} />);

    // 畳んだ状態: 途中までしか出ていない
    expect(screen.getByText("1 行目の本文…")).toBeInTheDocument();
    expect(screen.queryByText(LONG_BODY, asIs)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "すべて表示する" }));

    expect(screen.getByText(LONG_BODY, asIs)).toBeInTheDocument();
    expect(screen.queryByText("1 行目の本文…")).not.toBeInTheDocument();

    // 広げたあとも畳むボタンが残る（オーナーと確定済み）
    await user.click(screen.getByRole("button", { name: "折りたたむ" }));

    expect(screen.getByText("1 行目の本文…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "すべて表示する" })).toBeInTheDocument();
  });

  it("広げた状態から描ける（story とスクリーンショットのため）", () => {
    render(
      <MessageLinkCard
        card={okCard({ body: LONG_BODY, clampedBody: "1 行目の本文…", clamped: true })}
        defaultExpanded
      />,
    );

    expect(screen.getByText(LONG_BODY, asIs)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "折りたたむ" })).toBeInTheDocument();
  });

  it("HTML を書いても、タグとして解釈されない", () => {
    const body = '<script>alert("x")</script>';
    const { container } = render(<MessageLinkCard card={okCard({ body, clampedBody: body })} />);

    expect(screen.getByText(body)).toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();
  });
});
