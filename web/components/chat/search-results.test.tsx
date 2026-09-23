import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SearchResults } from "./search-results";
import type { SearchResultView } from "./types";

const naoki = { id: "01J8ZH5K000000000000000002", name: "佐藤 直樹" };

const results: SearchResultView[] = [
  {
    key: "m1",
    href: "/w/w1/r/r1?m=m1",
    room: { kind: "public", name: "デザインレビュー" },
    sender: naoki,
    timeLabel: "今日 10:42",
    body: "来週の面談の日程を押さえました。",
    attachmentCount: 0,
  },
  {
    key: "m2",
    href: "/w/w1/r/r2?m=m2&t=m0",
    room: { kind: "private", name: "リリース準備" },
    sender: naoki,
    timeLabel: "昨日 16:12",
    body: "Deploy のあとで面談の時間を取れますか。",
    inThread: true,
    attachmentCount: 1,
  },
];

describe("SearchResults（ADR 0061）", () => {
  it("受け取った順にカードを並べ、そのメッセージへのリンクを出す（6.11 の仕組みで飛ぶ）", () => {
    render(<SearchResults query="面談" filters={{}} results={results} highlightTerms={["面談"]} />);

    const cards = within(screen.getByRole("list", { name: "検索結果" })).getAllByRole("listitem");
    expect(cards).toHaveLength(2);
    expect(within(cards[0]).getByRole("link")).toHaveAttribute("href", "/w/w1/r/r1?m=m1");
    expect(within(cards[0]).getByText("デザインレビュー")).toBeInTheDocument();
    expect(within(cards[1]).getByText("スレッドの返信")).toBeInTheDocument();
    expect(within(cards[1]).getByText("添付 1 件")).toBeInTheDocument();
  });

  it("一致した部分をマーカーで塗る（大文字小文字と全角半角は正規化して当てる）", () => {
    render(<SearchResults query="deploy" filters={{}} results={results} highlightTerms={["ｄｅｐｌｏｙ", "面談"]} />);

    const marks = screen.getAllByText((_, el) => el?.tagName === "MARK").map((el) => el.textContent);
    expect(marks).toContain("Deploy");
    expect(marks).toContain("面談");
  });

  it("塗る語がなければ mark を出さない", () => {
    render(<SearchResults query="面談" filters={{}} results={results} highlightTerms={[]} />);

    expect(screen.queryAllByText((_, el) => el?.tagName === "MARK")).toHaveLength(0);
  });

  it("0 件なら、打ち直しと絞り込みを外すことを促す", () => {
    render(<SearchResults query="ハチドリ" filters={{}} results={[]} highlightTerms={["ハチドリ"]} />);

    expect(screen.getByText("「ハチドリ」に一致するメッセージはありません")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "検索結果" })).not.toBeInTheDocument();
  });

  it("取得中（results が undefined）は、0 件の知らせを出さない", () => {
    render(<SearchResults query="面談" filters={{}} highlightTerms={["面談"]} />);

    expect(screen.queryByText(/一致するメッセージはありません/)).not.toBeInTheDocument();
  });

  it("絞り込みのチップは、設定してあれば値を出し、× で外せる", async () => {
    const onClearFilter = vi.fn();
    render(
      <SearchResults
        query="面談"
        filters={{ sender: { id: "u1", name: "佐藤 直樹" }, room: { id: "r2", kind: "private", name: "リリース準備" } }}
        results={results}
        highlightTerms={["面談"]}
        onClearFilter={onClearFilter}
      />,
    );

    expect(screen.getByRole("button", { name: "送信者：佐藤 直樹" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "場所：リリース準備" })).toBeInTheDocument();
    // 設定していないものはラベルだけ（× も出さない）
    expect(screen.getByRole("button", { name: "日付" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "日付の絞り込みを外す" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "場所の絞り込みを外す" }));
    expect(onClearFilter).toHaveBeenCalledWith("room");
  });

  it("チップと「フィルター」は、どちらも同じダイアログを開く", async () => {
    const onOpenFilters = vi.fn();
    render(
      <SearchResults query="面談" filters={{}} results={results} highlightTerms={["面談"]} onOpenFilters={onOpenFilters} />,
    );

    await userEvent.click(screen.getByRole("button", { name: "送信者" }));
    await userEvent.click(screen.getByRole("button", { name: "フィルター" }));
    expect(onOpenFilters).toHaveBeenCalledTimes(2);
  });

  it("件数も並べ替えも出さない（ADR 0061 決定 4。O(1) で出せないため）", () => {
    render(<SearchResults query="面談" filters={{}} results={results} highlightTerms={["面談"]} />);

    expect(screen.queryByText(/件の結果/)).not.toBeInTheDocument();
    expect(screen.queryByText(/並べ替え/)).not.toBeInTheDocument();
  });
});
