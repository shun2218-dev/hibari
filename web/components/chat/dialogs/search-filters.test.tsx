import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SearchFiltersDialog } from "./search-filters";

const naoki = { id: "01J8ZH5K000000000000000002", name: "佐藤 直樹" };
const rooms = [
  { id: "r2", kind: "private" as const, name: "リリース準備" },
  { id: "r3", kind: "public" as const, name: "リリースノート" },
];

const base = {
  open: true,
  filters: {},
  senderQuery: "",
  senderOptions: [],
  roomQuery: "",
  roomOptions: [],
  date: "any" as const,
};

describe("SearchFiltersDialog（ADR 0061 決定 5）", () => {
  it("6.16 で作る 3 つ（送信者・場所・日付）だけを出す", () => {
    render(<SearchFiltersDialog {...base} />);

    expect(screen.getByLabelText("送信者")).toBeInTheDocument();
    expect(screen.getByLabelText("場所")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "日付" })).toBeInTheDocument();
    // Slack にはあるがスコープ外にしたもの
    expect(screen.queryByText("ファイルタイプ")).not.toBeInTheDocument();
    expect(screen.queryByText("絵文字リアクション")).not.toBeInTheDocument();
  });

  it("候補を押すと、選んだ値を返す", async () => {
    const onSelectRoom = vi.fn();
    const onSelectSender = vi.fn();
    render(
      <SearchFiltersDialog
        {...base}
        senderQuery="佐藤"
        senderOptions={[naoki]}
        roomQuery="リリース"
        roomOptions={rooms}
        onSelectSender={onSelectSender}
        onSelectRoom={onSelectRoom}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "佐藤 直樹" }));
    expect(onSelectSender).toHaveBeenCalledWith(naoki);
    await userEvent.click(screen.getByRole("button", { name: "リリース準備" }));
    expect(onSelectRoom).toHaveBeenCalledWith(rooms[0]);
  });

  it("選んである値を印として出す", () => {
    render(<SearchFiltersDialog {...base} filters={{ sender: { id: naoki.id, name: naoki.name } }} />);

    expect(screen.getByText("佐藤 直樹 で絞り込みます")).toBeInTheDocument();
  });

  it("日付は選んだものだけが押された状態になる", async () => {
    const onChangeDate = vi.fn();
    render(<SearchFiltersDialog {...base} date="7d" onChangeDate={onChangeDate} />);

    expect(screen.getByRole("radio", { name: "過去 7 日間" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "いつでも" })).not.toBeChecked();

    await userEvent.click(screen.getByRole("radio", { name: "今日" }));
    expect(onChangeDate).toHaveBeenCalledWith("today");
  });

  it("「フィルターをクリアする」と「検索する」を出す", async () => {
    const onClear = vi.fn();
    const onSubmit = vi.fn();
    render(<SearchFiltersDialog {...base} onClear={onClear} onSubmit={onSubmit} />);

    await userEvent.click(screen.getByRole("button", { name: "フィルターをクリアする" }));
    expect(onClear).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "検索する" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("閉じているときは何も描かない", () => {
    render(<SearchFiltersDialog {...base} open={false} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
