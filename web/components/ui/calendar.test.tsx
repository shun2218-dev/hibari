import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Calendar } from "./calendar";

function renderCalendar(props: Partial<Parameters<typeof Calendar>[0]> = {}) {
  return render(<Calendar month="2026-09" today="2026-09-21" min="2026-09-21" {...props} />);
}

describe("Calendar", () => {
  it("月の見出しと、その月の日を出す", () => {
    renderCalendar();

    expect(screen.getByText("2026年9月")).toBeInTheDocument();
    expect(screen.getAllByRole("gridcell", { name: /2026年9月/ })).toHaveLength(30);
  });

  it("押した日を返す", async () => {
    const onSelect = vi.fn();
    renderCalendar({ onSelect });

    await userEvent.click(screen.getByRole("gridcell", { name: "2026年9月25日（金）" }));

    expect(onSelect).toHaveBeenCalledWith("2026-09-25");
  });

  it("min より前の日は押せない（過ぎた期限を作らせない）", async () => {
    const onSelect = vi.fn();
    renderCalendar({ onSelect });

    const past = screen.getByRole("gridcell", { name: "2026年9月20日（日）" });
    expect(past).toBeDisabled();
    await userEvent.click(past);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("前後の月に送れる", async () => {
    const onChangeMonth = vi.fn();
    renderCalendar({ onChangeMonth });

    await userEvent.click(screen.getByRole("button", { name: "前の月" }));
    await userEvent.click(screen.getByRole("button", { name: "次の月" }));

    expect(onChangeMonth).toHaveBeenNthCalledWith(1, "2026-08");
    expect(onChangeMonth).toHaveBeenNthCalledWith(2, "2026-10");
  });

  it("矢印で日を移れる。Tab で 42 個を通らないよう、フォーカスを受けるのは 1 つだけ", async () => {
    renderCalendar({ value: "2026-09-25" });

    const selected = screen.getByRole("gridcell", { name: "2026年9月25日（金）" });
    expect(selected).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("gridcell", { name: "2026年9月24日（木）" })).toHaveAttribute("tabindex", "-1");

    selected.focus();
    await userEvent.keyboard("{ArrowRight}");
    // フォーカスは描き直しの後に当てるので、待ってから確かめる
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "2026年9月26日（土）" })).toHaveFocus());
    await userEvent.keyboard("{ArrowUp}");
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "2026年9月19日（土）" })).toHaveFocus());
  });

  it("月をまたぐ矢印では、その月に送る", async () => {
    const onChangeMonth = vi.fn();
    renderCalendar({ value: "2026-09-30", onChangeMonth });

    screen.getByRole("gridcell", { name: "2026年9月30日（水）" }).focus();
    await userEvent.keyboard("{ArrowRight}");

    expect(onChangeMonth).toHaveBeenCalledWith("2026-10");
  });
});
