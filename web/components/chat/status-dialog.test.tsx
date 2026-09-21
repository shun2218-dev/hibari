import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { STATUS_TEXT_MAX, StatusDialog } from "./status-dialog";

// 絵文字のピッカー（emoji-mart）は外のライブラリなので描かない。開いたかどうかだけを見る（ADR 0044 決定 7）
vi.mock("./emoji-picker", () => ({ EmojiPicker: () => <div data-testid="emoji-picker" /> }));

describe("StatusDialog（ADR 0049）", () => {
  it("設定していなければ、既定の絵文字と空の入力を出し、削除は出さない", () => {
    render(<StatusDialog open text="" expiry="none" />);

    expect(screen.getByLabelText("ステータス")).toHaveValue("");
    expect(screen.queryByRole("button", { name: "削除" })).not.toBeInTheDocument();
  });

  it("設定済みなら削除を出し、押すと呼ばれる", async () => {
    const onClear = vi.fn();
    render(<StatusDialog open emoji="🍵" text="休憩中" expiry="today" canClear onClear={onClear} />);

    await userEvent.click(screen.getByRole("button", { name: "削除" }));

    expect(onClear).toHaveBeenCalledOnce();
  });

  it("候補を押すと、絵文字と文言がそのまま渡る", async () => {
    const onSelectPreset = vi.fn();
    render(<StatusDialog open text="" expiry="none" onSelectPreset={onSelectPreset} />);

    await userEvent.click(screen.getByRole("button", { name: "会議中" }));

    expect(onSelectPreset).toHaveBeenCalledWith({ emoji: "📅", text: "会議中" });
  });

  it("文言は 100 文字までしか打てない", async () => {
    const onChangeText = vi.fn();
    render(<StatusDialog open text="" expiry="none" onChangeText={onChangeText} />);

    const input = screen.getByLabelText("ステータス");
    expect(input).toHaveAttribute("maxLength", String(STATUS_TEXT_MAX));
    await userEvent.type(input, "あ");
    expect(onChangeText).toHaveBeenCalledWith("あ");
  });

  it("消す時刻を選ぶと、選んだ種類が渡る（絶対の時刻にするのはデータ層）", async () => {
    const onChangeExpiry = vi.fn();
    render(<StatusDialog open text="休憩中" expiry="none" onChangeExpiry={onChangeExpiry} />);

    // 文言と並びは Slack に合わせてある
    expect(screen.getByText("次の時間の経過後に削除")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "削除しない" })).toBeChecked();
    await userEvent.click(screen.getByRole("radio", { name: "1 時間" }));

    expect(onChangeExpiry).toHaveBeenCalledWith("1h");
  });

  it("「日時を選択」のときだけ、日付と時刻のボタンを出す", () => {
    const { rerender } = render(<StatusDialog open text="休憩中" expiry="today" />);
    expect(screen.queryByRole("button", { name: "削除する日付" })).not.toBeInTheDocument();

    rerender(<StatusDialog open text="休憩中" expiry="custom" custom={{ date: "2026-09-25", time: "17:00" }} />);

    // ブラウザ標準の入力ではなく、押すと自前のカレンダー / 一覧が開くボタン（ADR 0049 の追記）
    expect(screen.getByRole("button", { name: "削除する日付" })).toHaveTextContent("2026年9月25日（金）");
    expect(screen.getByRole("button", { name: "削除する時刻" })).toHaveTextContent("17:00");
  });

  it("カレンダーで選んだ日付を、時刻を保ったまま返す", async () => {
    const onChangeCustom = vi.fn();
    render(
      <StatusDialog
        open
        text="休憩中"
        expiry="custom"
        custom={{ date: "2026-09-25", time: "17:00" }}
        calendarMonth="2026-09"
        today="2026-09-21"
        openPicker="date"
        onChangeCustom={onChangeCustom}
      />,
    );

    await userEvent.click(screen.getByRole("gridcell", { name: "2026年9月28日（月）" }));

    expect(onChangeCustom).toHaveBeenCalledWith({ date: "2026-09-28", time: "17:00" });
  });

  it("時刻は 30 分刻みで、今日なら過ぎた時刻を出さない", async () => {
    const onChangeCustom = vi.fn();
    render(
      <StatusDialog
        open
        text="休憩中"
        expiry="custom"
        custom={{ date: "2026-09-21", time: "" }}
        today="2026-09-21"
        minTime="17:00"
        openPicker="time"
        onChangeCustom={onChangeCustom}
      />,
    );

    // 一覧は選んでいる時刻が見える位置から始める（jsdom には scrollIntoView が無いので置き換える）
    expect(screen.queryByRole("radio", { name: "16:30" })).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "17:30" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "17:30" }));

    expect(onChangeCustom).toHaveBeenCalledWith({ date: "2026-09-21", time: "17:30" });
  });

  it("絵文字のボタンでピッカーを開け閉めする", async () => {
    const onTogglePicker = vi.fn();
    const { rerender } = render(<StatusDialog open text="" expiry="none" onTogglePicker={onTogglePicker} />);

    expect(screen.queryByTestId("emoji-picker")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "絵文字を選ぶ" }));
    expect(onTogglePicker).toHaveBeenCalledOnce();

    rerender(<StatusDialog open text="" expiry="none" pickerOpen onTogglePicker={onTogglePicker} />);
    expect(screen.getByTestId("emoji-picker")).toBeInTheDocument();
  });

  it("閉じていれば何も描かない", () => {
    render(<StatusDialog open={false} text="休憩中" expiry="none" />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
