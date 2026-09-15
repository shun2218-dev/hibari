import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MessageItem } from "./message-item";
import type { MessageView } from "./types";

function message(overrides: Partial<MessageView> = {}): MessageView {
  return {
    key: "m1",
    sender: { id: "01J8ZH5K000000000000000002", name: "佐藤 直樹" },
    timeLabel: "10:12",
    body: "賛成です。",
    status: "sent",
    deleted: false,
    edited: false,
    attachments: [],
    grouped: false,
    ...overrides,
  };
}

describe("MessageItem", () => {
  it("shows the sender, time and body of a sent message", () => {
    render(<MessageItem message={message()} />);

    const article = screen.getByRole("article", { name: "佐藤 直樹 10:12" });
    expect(within(article).getByText("佐藤 直樹")).toBeInTheDocument();
    expect(within(article).getByText("10:12")).toBeInTheDocument();
    expect(within(article).getByText("賛成です。")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "送信中" })).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "返信", hidden: true })).toBeInTheDocument();
  });

  it("marks a pending message as sending", () => {
    render(<MessageItem message={message({ status: "pending" })} />);

    expect(screen.getByRole("img", { name: "送信中" })).toBeInTheDocument();
    expect(screen.getByText("賛成です。")).toHaveClass("text-text-muted");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("offers retry and discard for a failed message", async () => {
    const onRetry = vi.fn();
    const onDiscard = vi.fn();
    render(<MessageItem message={message({ status: "failed" })} onRetry={onRetry} onDiscard={onDiscard} />);

    expect(screen.getByRole("alert")).toHaveTextContent("送信できませんでした");
    // 送信失敗には専用の操作があるので、ホバーの操作は出さない
    expect(screen.queryByRole("button", { name: "返信", hidden: true })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "再送する" }));
    await userEvent.click(screen.getByRole("button", { name: "削除" }));

    expect(onRetry).toHaveBeenCalledOnce();
    expect(onDiscard).toHaveBeenCalledOnce();
  });

  it("hides the body, reply, attachments and actions of a deleted message", () => {
    render(
      <MessageItem
        message={message({
          deleted: true,
          body: "",
          replyTo: { senderName: "あなた", body: "元の発言" },
          attachments: [{ kind: "file", id: "a1", fileName: "secret.pdf", sizeLabel: "1 KB" }],
        })}
      />,
    );

    expect(screen.getByText("このメッセージは削除されました")).toBeInTheDocument();
    expect(screen.queryByText("元の発言")).not.toBeInTheDocument();
    expect(screen.queryByText("secret.pdf")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "返信", hidden: true })).not.toBeInTheDocument();
  });

  it("labels an edited message", () => {
    render(<MessageItem message={message({ edited: true })} />);

    expect(screen.getByText("（編集済み）")).toBeInTheDocument();
  });

  it("shows the message it replies to", () => {
    render(<MessageItem message={message({ replyTo: { senderName: "あなた", body: "琥珀と緑の分け方です。" } })} />);

    expect(screen.getByText("あなた")).toBeInTheDocument();
    expect(screen.getByText("琥珀と緑の分け方です。")).toBeInTheDocument();
  });

  it("omits the avatar and header of a grouped message", () => {
    render(<MessageItem message={message({ grouped: true })} />);

    expect(screen.queryByText("佐藤 直樹")).not.toBeInTheDocument();
    expect(screen.getByText("賛成です。")).toBeInTheDocument();
  });

  it("renders image and file attachments", async () => {
    const onDownload = vi.fn();
    render(
      <MessageItem
        onDownload={onDownload}
        message={message({
          attachments: [
            { kind: "image", id: "a1", fileName: "sidebar.png", width: 260, height: 160, url: "https://storage.test/a1" },
            { kind: "file", id: "a2", fileName: "type-scale.pdf", sizeLabel: "248 KB" },
          ],
        })}
      />,
    );

    expect(screen.getByRole("img", { name: "sidebar.png" })).toHaveAttribute("src", "https://storage.test/a1");
    expect(screen.getByText("type-scale.pdf")).toBeInTheDocument();
    expect(screen.getByText("248 KB")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "ダウンロード" }));
    expect(onDownload).toHaveBeenCalledWith("a2");
  });
});
