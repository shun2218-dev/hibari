import { fireEvent, render, screen, within } from "@testing-library/react";
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

describe("MessageItem のリンクのカード（ADR 0040）", () => {
  const card = {
    key: "01J8ZH5K000000000000000001/01J8ZH5K000000000000000002",
    state: "ok",
    href: "https://hibari.example/w/01J8ZH5K000000000000000000/r/01J8ZH5K000000000000000001?m=01J8ZH5K000000000000000002",
    room: { kind: "public", name: "雑談" },
    sender: { id: "01J8ZH5K000000000000000003", name: "田中 美咲" },
    timeLabel: "09:41",
    body: "こちらが元の発言です。",
    clampedBody: "こちらが元の発言です。",
    clamped: false,
    attachmentCount: 0,
    inThread: false,
  } as const;

  it("本文の下にカードを出す", () => {
    render(<MessageItem message={message({ body: "これを見て", linkCards: [card] })} />);

    expect(screen.getByText("これを見て")).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "田中 美咲 のメッセージ" })).toBeInTheDocument();
  });

  it("削除済みのメッセージにはカードを出さない", () => {
    render(<MessageItem message={message({ deleted: true, linkCards: [card] })} />);

    expect(screen.queryByRole("article", { name: "田中 美咲 のメッセージ" })).not.toBeInTheDocument();
  });

  it("読めないリンクのカードは、中身を出さない", () => {
    render(<MessageItem message={message({ linkCards: [{ key: "k", state: "unavailable" }] })} />);

    expect(screen.getByText("このメッセージは表示できません")).toBeInTheDocument();
  });

  it("「リンクをコピー」をメニューに出し、押すと呼ばれる", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <MessageItem
        message={message()}
        copyLink={{ label: "リンクをコピー", onClick }}
        menuOpen
        onToggleMenu={() => {}}
      />,
    );

    await user.click(screen.getByRole("button", { name: "リンクをコピー" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("コピーの結果は、呼ぶ側が決めた文言で出す", () => {
    render(<MessageItem message={message()} copyLink={{ label: "コピーしました", onClick: () => {} }} menuOpen />);

    expect(screen.getByRole("button", { name: "コピーしました" })).toBeInTheDocument();
  });

  it("編集も削除もできなくても、「リンクをコピー」だけで「…」を出す", () => {
    render(<MessageItem message={message()} copyLink={{ label: "リンクをコピー", onClick: () => {} }} />);

    expect(screen.getByRole("button", { name: "その他の操作", hidden: true })).toBeInTheDocument();
  });

  it("コピーできないメッセージ（送信中）では「…」を出さない", () => {
    render(<MessageItem message={message({ status: "pending" })} />);

    expect(screen.queryByRole("button", { name: "その他の操作", hidden: true })).not.toBeInTheDocument();
  });
});

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
    // 本文はメンションのチップに分かれうるので、色は段落に付く（ADR 0043）
    expect(screen.getByText("賛成です。").closest("p")).toHaveClass("text-text-muted");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("自分宛ての行は琥珀にする（ADR 0043）", () => {
    const { rerender } = render(<MessageItem message={message({ mentionsMe: true })} />);

    const article = screen.getByRole("article", { name: "佐藤 直樹 10:12 あなた宛て" });
    expect(article).toHaveClass("bg-attention-subtle");

    rerender(<MessageItem message={message()} />);
    expect(screen.getByRole("article", { name: "佐藤 直樹 10:12" })).not.toHaveClass("bg-attention-subtle");
  });

  it("削除されたメッセージは自分宛てでも琥珀にしない", () => {
    render(<MessageItem message={message({ mentionsMe: true, deleted: true })} />);

    expect(screen.getByRole("article", { name: "佐藤 直樹 10:12" })).not.toHaveClass("bg-attention-subtle");
  });

  it("本文のメンションをチップにする", () => {
    const alice = "01J8ZZZZZZZZZZZZZZZZZZZZZA";
    render(
      <MessageItem
        message={message({ body: `<@${alice}> お願いします`, mentionNames: { [alice]: "田中 あおい" } })}
      />,
    );

    expect(screen.getByRole("button", { name: "@田中 あおい" })).toBeInTheDocument();
    expect(screen.getByText("お願いします", { exact: false })).toBeInTheDocument();
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

  it("hides the body, attachments and actions of a deleted message", () => {
    render(
      <MessageItem
        message={message({
          deleted: true,
          body: "",
          attachments: [{ kind: "file", id: "a1", fileName: "secret.pdf", sizeLabel: "1 KB" }],
        })}
      />,
    );

    expect(screen.getByText("このメッセージは削除されました")).toBeInTheDocument();
    expect(screen.queryByText("secret.pdf")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "返信", hidden: true })).not.toBeInTheDocument();
  });

  it("labels an edited message", () => {
    render(<MessageItem message={message({ edited: true })} />);

    expect(screen.getByText("（編集済み）")).toBeInTheDocument();
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

  it("shows the file name in the image frame until the url arrives, and reports images that fail to load", () => {
    const onImageError = vi.fn();
    const image = { kind: "image" as const, id: "a1", fileName: "sidebar.png", width: 260, height: 160 };
    const { rerender } = render(<MessageItem onImageError={onImageError} message={message({ attachments: [image] })} />);

    expect(screen.queryByRole("img", { name: "sidebar.png" })).not.toBeInTheDocument();
    expect(screen.getByText("sidebar.png")).toBeInTheDocument();

    rerender(
      <MessageItem
        onImageError={onImageError}
        message={message({ attachments: [{ ...image, url: "https://storage.test/expired" }] })}
      />,
    );
    fireEvent.error(screen.getByRole("img", { name: "sidebar.png" }));

    expect(onImageError).toHaveBeenCalledWith("a1", "https://storage.test/expired");
  });
});

describe("MessageItem actions", () => {
  it("offers the menu only when something can be done", async () => {
    const onToggleMenu = vi.fn();
    const { rerender } = render(<MessageItem message={message()} />);
    expect(screen.queryByRole("button", { name: "その他の操作", hidden: true })).not.toBeInTheDocument();

    rerender(<MessageItem message={message()} canEdit onToggleMenu={onToggleMenu} />);
    await userEvent.click(screen.getByRole("button", { name: "その他の操作", hidden: true }));
    expect(onToggleMenu).toHaveBeenCalledOnce();
  });

  it("shows only the permitted menu items", async () => {
    const onDelete = vi.fn();
    const { rerender } = render(<MessageItem message={message()} canEdit canDelete menuOpen />);

    const menu = screen.getByRole("dialog", { name: "メッセージの操作" });
    expect(within(menu).getByRole("button", { name: "メッセージを編集" })).toBeInTheDocument();
    expect(within(menu).getByRole("button", { name: "メッセージを削除" })).toBeInTheDocument();

    // 他人のメッセージを管理者として消すだけのとき、編集は出さない
    rerender(<MessageItem message={message()} canDelete menuOpen onDelete={onDelete} />);
    expect(screen.queryByRole("button", { name: "メッセージを編集" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "メッセージを削除" }));
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it("replaces the body with an editor while editing", async () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    const onChange = vi.fn();
    render(
      <MessageItem
        message={message({ attachments: [{ kind: "file", id: "a1", fileName: "x.pdf", sizeLabel: "1 KB" }] })}
        canEdit
        editing={{ value: "賛成です。", onChange, onSave, onCancel }}
      />,
    );

    const editor = screen.getByRole("textbox", { name: "メッセージを編集" });
    expect(editor).toHaveValue("賛成です。");
    // 編集中は本文・添付・ホバーの操作を出さない
    expect(screen.queryByText("x.pdf")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "返信", hidden: true })).not.toBeInTheDocument();

    await userEvent.type(editor, "！");
    expect(onChange).toHaveBeenLastCalledWith("賛成です。！");

    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("saves with Enter and cancels with Escape", async () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    render(<MessageItem message={message()} canEdit editing={{ value: "賛成です。", onSave, onCancel }} />);
    const editor = screen.getByRole("textbox", { name: "メッセージを編集" });

    await userEvent.type(editor, "{Enter}");
    expect(onSave).toHaveBeenCalledOnce();

    await userEvent.type(editor, "{Shift>}{Enter}{/Shift}");
    expect(onSave).toHaveBeenCalledOnce();

    await userEvent.type(editor, "{Escape}");
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("does not save an empty message", async () => {
    const onSave = vi.fn();
    render(<MessageItem message={message()} canEdit editing={{ value: "   ", onSave }} />);

    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    await userEvent.type(screen.getByRole("textbox", { name: "メッセージを編集" }), "{Enter}");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("shows the thread summary under a thread root and opens the thread (ADR 0036)", async () => {
    const onOpenThread = vi.fn();
    render(
      <MessageItem message={message({ thread: { replyCount: 3, lastReplyLabel: "10:18" } })} onOpenThread={onOpenThread} />,
    );

    const summary = screen.getByRole("button", { name: /3 件の返信/ });
    expect(summary).toHaveTextContent("最終返信 10:18");
    await userEvent.click(summary);
    expect(onOpenThread).toHaveBeenCalledOnce();
  });

  it("keeps the thread summary on a deleted root, because the replies remain", () => {
    render(<MessageItem message={message({ deleted: true, thread: { replyCount: 2, lastReplyLabel: "09:48" } })} />);

    expect(screen.getByText("このメッセージは削除されました")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /2 件の返信/ })).toBeInTheDocument();
  });

  it("does not show the thread summary without replies", () => {
    render(<MessageItem message={message()} />);

    expect(screen.queryByRole("button", { name: /件の返信/ })).not.toBeInTheDocument();
  });

  it("highlights the root whose thread is open", () => {
    render(<MessageItem message={message()} threadOpen />);

    expect(screen.getByRole("article")).toHaveClass("bg-primary-subtle");
  });

  it("hides the reply action inside a thread (threads are not nested)", () => {
    const { rerender } = render(<MessageItem message={message()} canReply={false} />);
    expect(screen.queryByRole("button", { name: "返信", hidden: true })).not.toBeInTheDocument();

    // 編集・削除の「…」は、返信を出さなくても残る
    rerender(<MessageItem message={message()} canReply={false} canEdit />);
    expect(screen.queryByRole("button", { name: "返信", hidden: true })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "その他の操作", hidden: true })).toBeInTheDocument();
  });

  it("labels a reply posted to the channel too and opens its thread from the channel (ADR 0039)", async () => {
    const onOpenThread = vi.fn();
    render(<MessageItem message={message({ broadcast: { in: "channel" } })} onOpenThread={onOpenThread} />);

    await userEvent.click(screen.getByRole("button", { name: "スレッドに返信しました" }));

    expect(onOpenThread).toHaveBeenCalledOnce();
  });

  it("notes inside the thread that a reply was also posted to the channel", () => {
    render(
      <MessageItem message={message({ broadcast: { in: "thread", label: "チャンネルにも投稿しました" } })} canReply={false} />,
    );

    expect(screen.getByText("チャンネルにも投稿しました")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "スレッドに返信しました" })).not.toBeInTheDocument();
  });
});
