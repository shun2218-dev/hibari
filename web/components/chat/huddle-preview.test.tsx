import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { HuddleDeviceMenu, HuddlePreview } from "./huddle-preview";
import type { HuddlePreviewView } from "./types";

const mics = [
  { id: "m1", label: "既定のマイク" },
  { id: "m2", label: "AirPods Pro" },
];
const speakers = [{ id: "s1", label: "既定のスピーカー" }];

function preview(overrides: Partial<HuddlePreviewView> = {}): HuddlePreviewView {
  return {
    room: { kind: "public", name: "デザインレビュー" },
    action: "start",
    self: { id: "u1", name: "あなた" },
    micOn: true,
    mics,
    micId: "m1",
    speakers,
    speakerId: "s1",
    ...overrides,
  };
}

describe("HuddlePreview（ADR 0066 追記 B）", () => {
  it("どのルームで始めるかと、キャンセルと開始を出す", async () => {
    const onCancel = vi.fn();
    const onStart = vi.fn();
    render(<HuddlePreview preview={preview()} onCancel={onCancel} onStart={onStart} />);

    expect(screen.getByRole("heading")).toHaveTextContent("デザインレビューでハドルミーティングを開始する");
    await userEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    await userEvent.click(screen.getByRole("button", { name: "ハドルミーティングを開始する" }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onStart).toHaveBeenCalledOnce();
  });

  it("進行中のハドルには「参加する」", () => {
    render(<HuddlePreview preview={preview({ action: "join" })} />);

    expect(screen.getByRole("button", { name: "ハドルミーティングに参加する" })).toBeInTheDocument();
  });

  it("マイクのオンとオフを切り替えられる", async () => {
    const onToggleMic = vi.fn();
    const { rerender } = render(<HuddlePreview preview={preview()} onToggleMic={onToggleMic} />);

    await userEvent.click(screen.getByRole("button", { name: "マイクをオフにする" }));
    expect(onToggleMic).toHaveBeenCalledOnce();
    rerender(<HuddlePreview preview={preview({ micOn: false })} onToggleMic={onToggleMic} />);
    expect(screen.getByRole("button", { name: "マイクをオンにする" })).toHaveAttribute("aria-pressed", "true");
  });

  it("選んでいる機器を出し、開くと候補から選べる", async () => {
    const onToggleMenu = vi.fn();
    const onSelectMic = vi.fn();
    const { rerender } = render(<HuddlePreview preview={preview()} onToggleMenu={onToggleMenu} />);

    await userEvent.click(screen.getByRole("button", { name: "マイク: 既定のマイク" }));
    expect(onToggleMenu).toHaveBeenCalledWith("mic");

    rerender(<HuddlePreview preview={preview()} openMenu="mic" onSelectMic={onSelectMic} />);
    const menu = screen.getByRole("menu", { name: "マイク" });
    expect(within(menu).getByRole("menuitemradio", { name: "既定のマイク" })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(within(menu).getByRole("menuitemradio", { name: "AirPods Pro" }));
    expect(onSelectMic).toHaveBeenCalledWith("m2");
  });

  it("スピーカーを選べないブラウザでは、スピーカーの選択を出さない", () => {
    render(<HuddlePreview preview={preview({ speakers: undefined })} />);

    expect(screen.queryByRole("button", { name: /スピーカー/ })).not.toBeInTheDocument();
  });

  it.each([
    ["mic-denied", "許可していません"],
    ["no-mic", "マイクが見つかりません"],
  ] as const)("%s のときは知らせて、開始を押せなくする", (problem, text) => {
    render(<HuddlePreview preview={preview({ problem, mics: [], micId: undefined })} />);

    expect(screen.getByRole("alert")).toHaveTextContent(text);
    expect(screen.getByRole("button", { name: "ハドルミーティングを開始する" })).toBeDisabled();
  });
});

describe("HuddleDeviceMenu", () => {
  it("マイクとスピーカーを 1 つのメニューで選べる", async () => {
    const onSelectMic = vi.fn();
    const onSelectSpeaker = vi.fn();
    render(<HuddleDeviceMenu mics={mics} micId="m2" speakers={speakers} onSelectMic={onSelectMic} onSelectSpeaker={onSelectSpeaker} />);

    expect(screen.getByRole("menuitemradio", { name: "AirPods Pro" })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(screen.getByRole("menuitemradio", { name: "既定のマイク" }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: "既定のスピーカー" }));
    expect(onSelectMic).toHaveBeenCalledWith("m1");
    expect(onSelectSpeaker).toHaveBeenCalledWith("s1");
  });
});
