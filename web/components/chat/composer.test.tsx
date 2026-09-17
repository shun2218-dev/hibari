import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AttachmentChip, Composer, TypingIndicator } from "./composer";

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

describe("Composer reply", () => {
  it("shows the message being replied to and lets it be cancelled", async () => {
    const onCancelReply = vi.fn();
    render(
      <Composer
        value=""
        canSend={false}
        replyTo={{ senderName: "佐藤 直樹", body: "4px だと主張が強すぎて、名前より先に目が行ってしまう。" }}
        onCancelReply={onCancelReply}
      />,
    );

    expect(screen.getByText("佐藤 直樹 に返信")).toBeInTheDocument();
    expect(screen.getByText("4px だと主張が強すぎて、名前より先に目が行ってしまう。")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "返信をやめる" }));
    expect(onCancelReply).toHaveBeenCalledOnce();
  });

  it("shows no reply banner by default", () => {
    render(<Composer value="" canSend={false} />);

    expect(screen.queryByRole("button", { name: "返信をやめる" })).not.toBeInTheDocument();
  });
});
