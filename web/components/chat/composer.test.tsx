import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import type { MentionCandidate } from "@/lib/chat/mentions";

import { AttachmentChip, Composer, TypingIndicator } from "./composer";

const ALICE = "01J8ZZZZZZZZZZZZZZZZZZZZZA";
const candidates: MentionCandidate[] = [
  { kind: "user", id: ALICE, handle: "alice", name: "田中 あおい" },
  { kind: "user", id: "01J8ZZZZZZZZZZZZZZZZZZZZZB", handle: "bob", name: "佐藤 直樹" },
  { kind: "channel", description: "このチャンネルの全員" },
  { kind: "here", description: "いまオンラインの人" },
];

describe("Composer", () => {
  it("sends on Enter only when there is something to send", async () => {
    const onSend = vi.fn();
    const { rerender } = render(<Composer value="" canSend={false} onSend={onSend} />);

    await userEvent.type(screen.getByRole("textbox", { name: "メッセージ" }), "{Enter}");
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "送信" })).toBeDisabled();

    rerender(<Composer value="こんにちは" canSend onSend={onSend} />);
    await userEvent.type(screen.getByRole("textbox", { name: "メッセージ" }), "{Enter}");
    expect(onSend).toHaveBeenCalledOnce();
  });

  it("grows with the text it holds", () => {
    // jsdom はレイアウトを持たないので、中身の高さだけ差し替えて、入力欄に入れ直されるかを見る
    vi.spyOn(Element.prototype, "scrollHeight", "get").mockReturnValue(72);
    const { rerender } = render(<Composer value="1 行目" canSend />);

    rerender(<Composer value={"1 行目\n2 行目\n3 行目"} canSend />);

    expect(screen.getByRole("textbox", { name: "メッセージ" })).toHaveStyle({ height: "72px" });
  });

  it("does not send on Shift+Enter", async () => {
    const onSend = vi.fn();
    render(<Composer value="こんにちは" canSend onSend={onSend} />);

    await userEvent.type(screen.getByRole("textbox", { name: "メッセージ" }), "{Shift>}{Enter}{/Shift}");

    expect(onSend).not.toHaveBeenCalled();
  });

  it("does not send the Enter that confirms IME composition", () => {
    const onSend = vi.fn();
    render(<Composer value="こんにちは" canSend onSend={onSend} />);

    fireEvent.keyDown(screen.getByRole("textbox", { name: "メッセージ" }), { key: "Enter", isComposing: true });

    expect(onSend).not.toHaveBeenCalled();
  });

  it("reports the files chosen from the attach button", async () => {
    const onSelectFiles = vi.fn();
    const { container } = render(<Composer value="" canSend={false} onSelectFiles={onSelectFiles} />);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const click = vi.spyOn(input, "click");
    const files = [new File(["a"], "a.png", { type: "image/png" }), new File(["b"], "b.fig")];

    await userEvent.click(screen.getByRole("button", { name: "ファイルを添付" }));
    expect(click).toHaveBeenCalledOnce();
    await userEvent.upload(input, files);

    expect(onSelectFiles).toHaveBeenCalledWith(files);
  });

  it("reports typed text", async () => {
    const onChange = vi.fn();
    render(<Composer value="" canSend={false} onChange={onChange} />);

    await userEvent.type(screen.getByRole("textbox", { name: "メッセージ" }), "a");

    expect(onChange).toHaveBeenCalledWith("a");
  });

  it("offers posting a thread reply to the channel too", async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <Composer
        value=""
        canSend={false}
        target="thread"
        alsoInChannel={{ label: "チャンネルにも投稿する", checked: false, onChange }}
      />,
    );

    const checkbox = screen.getByRole("checkbox", { name: "チャンネルにも投稿する" });
    expect(checkbox).not.toBeChecked();
    await userEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith(true);

    rerender(
      <Composer
        value=""
        canSend={false}
        target="thread"
        alsoInChannel={{ label: "チャンネルにも投稿する", checked: true, onChange }}
      />,
    );
    expect(screen.getByRole("checkbox", { name: "チャンネルにも投稿する" })).toBeChecked();
  });

  it("has no channel checkbox unless asked for", () => {
    render(<Composer value="" canSend={false} />);

    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});

describe("Composer の @ 補完（ADR 0043）", () => {
  /** 親が本文を持つので、テストの中でも同じように持ち回る。 */
  function Harness({ onSend }: { onSend?: () => void } = {}) {
    const [value, setValue] = useState("");
    return <Composer value={value} onChange={setValue} canSend onSend={onSend} mentionCandidates={candidates} />;
  }

  it("@ を打つと候補が出て、選ぶとハンドルが入る", async () => {
    render(<Harness />);
    const input = screen.getByRole("textbox", { name: "メッセージ" });

    await userEvent.type(input, "やあ @ali");

    const list = screen.getByRole("list", { name: "メンションの候補" });
    expect(within(list).getByText("田中 あおい")).toBeInTheDocument();
    expect(within(list).queryByText("佐藤 直樹")).not.toBeInTheDocument();

    await userEvent.click(within(list).getByText("田中 あおい"));
    expect(input).toHaveValue("やあ @alice ");
    expect(screen.queryByRole("list", { name: "メンションの候補" })).not.toBeInTheDocument();
  });

  it("確定したあとに打った文字は、ハンドルの後ろに続く（遅れて来るフレームで戻らない）", async () => {
    // キャレットを「描き直しの次のフレーム」で置き直していたころは、フレームが来る前に打ち続けると
    // そこでキャレットがハンドルの直後に戻り、続きの文字が割り込んだ。フレームを手で進めて確かめる
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
    render(<Harness />);
    const input = screen.getByRole("textbox", { name: "メッセージ" });

    await userEvent.type(input, "@ali");
    await userEvent.click(within(screen.getByRole("list", { name: "メンションの候補" })).getByText("田中 あおい"));
    // 打ち続けるだけ（type は押す前に click するので、キャレットが末尾に戻ってしまう）
    await userEvent.keyboard("おはよ");
    for (const frame of frames.splice(0)) frame(0);
    await userEvent.keyboard("う");

    expect(input).toHaveValue("@alice おはよう");
  });

  it("↑↓ で選び、Enter で確定する（送信しない）", async () => {
    const onSend = vi.fn();
    render(<Harness onSend={onSend} />);
    const input = screen.getByRole("textbox", { name: "メッセージ" });

    await userEvent.type(input, "@");
    await userEvent.keyboard("{ArrowDown}{Enter}");

    expect(input).toHaveValue("@bob ");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("Escape で閉じると、次の Enter は送信になる", async () => {
    const onSend = vi.fn();
    render(<Harness onSend={onSend} />);
    const input = screen.getByRole("textbox", { name: "メッセージ" });

    await userEvent.type(input, "@ali");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("list", { name: "メンションの候補" })).not.toBeInTheDocument();

    await userEvent.keyboard("{Enter}");
    expect(onSend).toHaveBeenCalledOnce();
  });

  it("@channel と @here も候補に出る", async () => {
    render(<Harness />);

    await userEvent.type(screen.getByRole("textbox", { name: "メッセージ" }), "@ch");

    const list = screen.getByRole("list", { name: "メンションの候補" });
    expect(within(list).getByText("@channel")).toBeInTheDocument();
    expect(within(list).queryByText("@here")).not.toBeInTheDocument();
  });

  it("誰にも当たらなければ閉じたままにする", async () => {
    render(<Harness />);

    await userEvent.type(screen.getByRole("textbox", { name: "メッセージ" }), "@zzz");

    expect(screen.queryByRole("list", { name: "メンションの候補" })).not.toBeInTheDocument();
  });

  it("候補を渡さなければ補完は開かない", async () => {
    render(<Composer value="@ali" canSend />);

    await userEvent.click(screen.getByRole("textbox", { name: "メッセージ" }));

    expect(screen.queryByRole("list", { name: "メンションの候補" })).not.toBeInTheDocument();
  });
});

describe("TypingIndicator", () => {
  it("names who is typing", () => {
    render(<TypingIndicator names={["高橋 みゆき", "中村 涼"]} />);

    expect(screen.getByText("高橋 みゆき、中村 涼 が入力中")).toBeInTheDocument();
  });

  it("renders nothing visible when nobody is typing", () => {
    const { container } = render(<TypingIndicator names={[]} />);

    expect(container.firstChild).toBeEmptyDOMElement();
  });
});

describe("AttachmentChip", () => {
  it("shows upload progress", async () => {
    const onRemove = vi.fn();
    render(
      <AttachmentChip attachment={{ id: "a1", fileName: "sidebar.fig", status: "uploading", progress: 62 }} onRemove={onRemove} />,
    );

    expect(screen.getByRole("progressbar", { name: "sidebar.fig をアップロード中" })).toHaveAttribute("aria-valuenow", "62");
    expect(screen.getByText("62%")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "アップロードを取り消す" }));
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it("offers retry and cancel when the upload failed", async () => {
    const onRetry = vi.fn();
    const onRemove = vi.fn();
    render(
      <AttachmentChip
        attachment={{ id: "a1", fileName: "sidebar.fig", status: "failed" }}
        onRetry={onRetry}
        onRemove={onRemove}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("アップロードできませんでした");
    await userEvent.click(screen.getByRole("button", { name: "再試行" }));
    await userEvent.click(screen.getByRole("button", { name: "取り消し" }));

    expect(onRetry).toHaveBeenCalledOnce();
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it("shows the size once uploaded", () => {
    render(<AttachmentChip attachment={{ id: "a1", fileName: "sidebar.fig", status: "uploaded", sizeLabel: "1.8 MB" }} />);

    expect(screen.getByRole("img", { name: "アップロード済み" })).toBeInTheDocument();
    expect(screen.getByText("1.8 MB")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
});

