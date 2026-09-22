import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { HOVER_OPEN_DELAY_MS } from "@/lib/use-hover-intent";

import { typeInEditor, valueOf } from "./editor/test-utils";
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

  // ADR 0049: 名前の横に出すのは絵文字だけで、文言はホバー（title）と読み上げで読む
  it("名前の横にカスタムステータスの絵文字を出す", () => {
    render(<MessageItem message={message({ sender: { id: "u2", name: "佐藤 直樹", status: { emoji: "📅", text: "会議中" } } })} />);

    expect(screen.getByRole("img", { name: "ステータス: 📅 会議中" })).toHaveAttribute("title", "会議中");
  });

  it("ステータスがなければ何も出さない", () => {
    render(<MessageItem message={message()} />);

    expect(screen.queryByRole("img", { name: /ステータス/ })).not.toBeInTheDocument();
  });

  it("marks a pending message as sending", () => {
    render(<MessageItem message={message({ status: "pending" })} />);

    expect(screen.getByRole("img", { name: "送信中" })).toBeInTheDocument();
    // 本文はブロックとチップに分かれうるので、色は本文全体の囲いに付ける（ADR 0043 / 0051）
    expect(screen.getByText("賛成です。").closest(".text-text-muted")).not.toBeNull();
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

    // ダウンロードはアイコンのボタン（文字は出さず、名前は読み上げと title に残す）
    const download = screen.getByRole("button", { name: "ダウンロード" });
    expect(download).not.toHaveTextContent("ダウンロード");
    expect(download).toHaveAttribute("title", "ダウンロード");
    await userEvent.click(download);
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

  it("closes the message menu when clicking outside or pressing Escape", async () => {
    const onToggleMenu = vi.fn();
    render(
      <div>
        <p>outside</p>
        <MessageItem message={message()} canEdit menuOpen onToggleMenu={onToggleMenu} />
      </div>,
    );

    await userEvent.click(screen.getByText("outside"));
    expect(onToggleMenu).toHaveBeenCalledOnce();

    await userEvent.keyboard("{Escape}");
    expect(onToggleMenu).toHaveBeenCalledTimes(2);
  });

  it("shows only the permitted menu items", async () => {
    const onDelete = vi.fn();
    const { rerender } = render(<MessageItem message={message()} canEdit canDelete menuOpen />);

    const menu = screen.getByRole("dialog", { name: "メッセージの操作" });
    expect(within(menu).getByRole("button", { name: "メッセージを編集" })).toBeInTheDocument();
    expect(within(menu).getByRole("button", { name: "メッセージを削除" })).toBeInTheDocument();
    // Slack のメニューと同じく、どの行も文字の前にアイコンがある
    for (const item of within(menu).getAllByRole("button")) expect(item.querySelector("svg")).not.toBeNull();

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
    expect(valueOf(editor)).toBe("賛成です。");
    // 編集中は本文・添付・ホバーの操作を出さない
    expect(screen.queryByText("x.pdf")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "返信", hidden: true })).not.toBeInTheDocument();

    await typeInEditor(editor, "！");
    expect(onChange).toHaveBeenLastCalledWith("賛成です。！");

    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("opens the editor with the formatting and mention chips of the body（ADR 0052 決定 2）", () => {
    const id = "01J8ZZZZZZZZZZZZZZZZZZZZZA";
    render(
      <MessageItem
        message={message({ mentionNames: { [id]: "田中 あおい" } })}
        canEdit
        editing={{ value: `*太字* と <@${id}>\n- 項目` }}
      />,
    );

    const editor = screen.getByRole("textbox", { name: "メッセージを編集" });
    expect(within(editor).getByText("太字").tagName).toBe("STRONG");
    expect(within(editor).getByText("@田中 あおい")).toHaveClass("text-primary");
    expect(within(editor).getByRole("listitem")).toHaveTextContent("項目");
    // 編集ではツールバーを出さない（記号の入力とショートカットで書式を付ける）
    expect(screen.queryByRole("toolbar", { name: "書式" })).not.toBeInTheDocument();
    expect(editor).toHaveClass("composer-lines");
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

  it("飛んできた先には琥珀の地を敷き、ほかの地より優先する（ADR 0042）", () => {
    const { rerender } = render(<MessageItem message={message()} highlighted />);
    expect(screen.getByRole("article")).toHaveClass("bg-attention-subtle");

    // スレッドを開いている親に飛んでも、飛んだ先の色にする
    rerender(<MessageItem message={message()} highlighted threadOpen />);
    expect(screen.getByRole("article")).toHaveClass("bg-attention-subtle");
    expect(screen.getByRole("article")).not.toHaveClass("bg-primary-subtle");
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

describe("MessageItem の絵文字のリアクション（ADR 0044）", () => {
  const reactions = [{ emoji: "👍", count: 2, me: true, names: ["あなた", "佐藤 直樹"] }];

  it("本文の下にリアクションの行を出す", () => {
    render(<MessageItem message={message({ reactions })} />);

    expect(screen.getByRole("button", { name: "あなた、佐藤 直樹が 👍 を付けました" })).toBeInTheDocument();
  });

  it("付いていなければ行を出さず、ホバーの「＋」から足す", async () => {
    const onTogglePicker = vi.fn();
    render(<MessageItem message={message()} onTogglePicker={onTogglePicker} />);

    await userEvent.click(screen.getByRole("button", { name: "リアクションを追加", hidden: true }));

    expect(onTogglePicker).toHaveBeenCalledOnce();
  });

  it("削除済み・送信中・送信失敗には、リアクションを出しも付けもしない", () => {
    // 削除は跡も残さず消える（ADR 0038）ので、付いていた行も一緒に消す
    const { rerender } = render(<MessageItem message={message({ deleted: true, reactions })} onTogglePicker={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /を付けました/, hidden: true })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "リアクションを追加", hidden: true })).not.toBeInTheDocument();

    // まだ ID の無いメッセージには PUT できない
    rerender(<MessageItem message={message({ status: "pending", reactions })} onTogglePicker={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "リアクションを追加", hidden: true })).not.toBeInTheDocument();

    rerender(<MessageItem message={message({ status: "failed", reactions })} onTogglePicker={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "リアクションを追加", hidden: true })).not.toBeInTheDocument();
  });

  it("ピッカーは開いているときだけ差し込む", () => {
    const picker = <p>ピッカーの中身</p>;
    const { rerender } = render(<MessageItem message={message()} onTogglePicker={vi.fn()} picker={picker} />);

    expect(screen.queryByText("ピッカーの中身")).not.toBeInTheDocument();

    rerender(<MessageItem message={message()} onTogglePicker={vi.fn()} picker={picker} pickerOpen />);

    expect(within(screen.getByRole("dialog", { name: "リアクションを選ぶ" })).getByText("ピッカーの中身")).toBeInTheDocument();
  });

  it("チップを押すと、その絵文字を渡して呼ぶ", async () => {
    const onToggleReaction = vi.fn();
    render(<MessageItem message={message({ reactions })} onToggleReaction={onToggleReaction} />);

    await userEvent.click(screen.getByRole("button", { name: "あなた、佐藤 直樹が 👍 を付けました" }));

    expect(onToggleReaction).toHaveBeenCalledWith("👍");
  });
});

describe("MessageItem の添付ファイル（ADR 0045）", () => {
  const image = { kind: "image", id: "a1", fileName: "改訂 01.png", url: "https://example/a1" } as const;
  const file = { kind: "file", id: "a2", fileName: "type-scale.pdf", sizeLabel: "248 KB" } as const;

  it("インライン表示している画像は押せて、どの添付かを渡して呼ぶ", async () => {
    const onOpenImage = vi.fn();
    render(<MessageItem message={message({ attachments: [image] })} onOpenImage={onOpenImage} />);

    const button = screen.getByRole("button", { name: "改訂 01.png を拡大表示" });
    // 画像はボタンに見えないので、押せることをカーソルで示す
    expect(button).toHaveClass("cursor-zoom-in");

    await userEvent.click(button);

    expect(onOpenImage).toHaveBeenCalledWith("a1");
  });

  it("まだ GET URL の取れていない画像は押せない", () => {
    render(<MessageItem message={message({ attachments: [{ ...image, url: undefined }] })} onOpenImage={vi.fn()} />);

    expect(screen.queryByRole("button", { name: /を拡大表示/ })).not.toBeInTheDocument();
  });

  it("画像でない添付の「…」から削除する。消せない人には出さない", async () => {
    const onDeleteAttachment = vi.fn();
    const onToggleAttachmentMenu = vi.fn();
    const { rerender } = render(
      <MessageItem message={message({ attachments: [file] })} onDeleteAttachment={onDeleteAttachment} />,
    );

    // canDelete が false のうちは「…」自体を出さない（判定はメッセージの削除と同じ。ADR 0045 決定 5）
    expect(screen.queryByRole("button", { name: "ファイルの操作" })).not.toBeInTheDocument();

    rerender(
      <MessageItem
        message={message({ attachments: [file] })}
        canDelete
        onDeleteAttachment={onDeleteAttachment}
        onToggleAttachmentMenu={onToggleAttachmentMenu}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "ファイルの操作" }));
    expect(onToggleAttachmentMenu).toHaveBeenCalledWith("a2");

    rerender(
      <MessageItem
        message={message({ attachments: [file] })}
        canDelete
        onDeleteAttachment={onDeleteAttachment}
        onToggleAttachmentMenu={onToggleAttachmentMenu}
        openAttachmentMenuId="a2"
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "ファイルを削除" }));

    expect(onDeleteAttachment).toHaveBeenCalledWith("a2");
  });

  it("画像の行には「…」を出さない（削除は拡大表示の中にある）", () => {
    render(<MessageItem message={message({ attachments: [image] })} canDelete onDeleteAttachment={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "ファイルの操作" })).not.toBeInTheDocument();
  });
});

describe("MessageItem のプロフィール（ADR 0050）", () => {
  // ホバーのカードは md 以上でだけ出す。jsdom には matchMedia が無いので、デスクトップとして当てる
  function asDesktop() {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
  }

  it("送信者のアバターと名前を押すと、送信者のプロフィールを開く", async () => {
    const onOpenProfile = vi.fn();
    render(<MessageItem message={message()} onOpenProfile={onOpenProfile} />);

    await userEvent.click(screen.getByRole("button", { name: "佐藤 直樹 のプロフィール" }));
    await userEvent.click(screen.getByRole("button", { name: "佐藤 直樹" }));
    expect(onOpenProfile).toHaveBeenNthCalledWith(1, "01J8ZH5K000000000000000002");
    expect(onOpenProfile).toHaveBeenNthCalledWith(2, "01J8ZH5K000000000000000002");
  });

  it("マウスを乗せて少したつと、ホバーのカードを出す", () => {
    asDesktop();
    vi.useFakeTimers();
    try {
      render(<MessageItem message={message()} onOpenProfile={vi.fn()} profileHoverCard={() => <p>カードの中身</p>} />);

      fireEvent.pointerEnter(screen.getByRole("button", { name: "佐藤 直樹 のプロフィール" }), { pointerType: "mouse" });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      act(() => vi.advanceTimersByTime(HOVER_OPEN_DELAY_MS));
      expect(screen.getByRole("dialog", { name: "佐藤 直樹 のプロフィール" })).toHaveTextContent("カードの中身");
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it("モバイルではホバーのカードを出さない（押せば全画面のパネル）", () => {
    render(
      <MessageItem message={message()} onOpenProfile={vi.fn()} profileHoverCard={() => <p>カードの中身</p>} forceProfileHover />,
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("開く先を渡さなければ、アバターと名前は押せない", () => {
    render(<MessageItem message={message()} />);

    expect(screen.queryByRole("button", { name: /佐藤 直樹/ })).not.toBeInTheDocument();
  });
});

describe("MessageItem のピン留めと「後で」（ADR 0054）", () => {
  it("ピン留めされていれば、本文の上に誰がピン留めしたかを出す", () => {
    render(<MessageItem message={message({ pinnedBy: "中村 涼" })} />);

    expect(screen.getByText("中村 涼 がピン留めしました")).toBeInTheDocument();
  });

  it("削除済みのメッセージには、ピン留めの印を出さない（削除でピンも外れる）", () => {
    render(<MessageItem message={message({ pinnedBy: "中村 涼", deleted: true })} />);

    expect(screen.queryByText("中村 涼 がピン留めしました")).not.toBeInTheDocument();
  });

  it("スレッドの親の「…」で返信の通知を切り替える（ADR 0056）", async () => {
    const onClick = vi.fn();
    const { rerender } = render(<MessageItem message={message()} threadNotify={{ notifying: true, onClick }} menuOpen />);

    await userEvent.click(screen.getByRole("button", { name: "返信の通知をオフにする" }));
    expect(onClick).toHaveBeenCalledOnce();

    rerender(<MessageItem message={message()} threadNotify={{ notifying: false, onClick }} menuOpen />);
    expect(screen.getByRole("button", { name: "新しい返信の通知を受け取る" })).toBeInTheDocument();
  });

  it("「…」にピン留めの操作を出し、押すと呼ぶ", async () => {
    const onClick = vi.fn();
    render(<MessageItem message={message()} pin={{ label: "チャンネルへピン留めする", onClick }} menuOpen />);

    await userEvent.click(screen.getByRole("button", { name: "チャンネルへピン留めする" }));

    expect(onClick).toHaveBeenCalledOnce();
  });

  it("ピン留めの操作だけでも「…」を出す", () => {
    render(<MessageItem message={message()} pin={{ label: "チャンネルへピン留めする", onClick: () => {} }} />);

    expect(screen.getByRole("button", { name: "その他の操作" })).toBeInTheDocument();
  });

  it.each([
    { saved: false, name: "「後で」に保存" },
    { saved: true, name: "「後で」から外す" },
  ])("ホバーの「後で」は保存済みかで名前と押している状態が変わる（saved: $saved）", async ({ saved, name }) => {
    const onClick = vi.fn();
    render(<MessageItem message={message()} canReply={false} save={{ saved, onClick }} />);

    const button = screen.getByRole("button", { name });
    expect(button).toHaveAttribute("aria-pressed", String(saved));
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it.each([
    { label: "送信中", overrides: { status: "pending" } as const },
    { label: "送信失敗", overrides: { status: "failed" } as const },
    { label: "削除済み", overrides: { deleted: true } },
  ])("$label のメッセージには「後で」を出さない（まだ ID がない・対象がない）", ({ overrides }) => {
    render(<MessageItem message={message(overrides)} save={{ saved: false, onClick: () => {} }} />);

    expect(screen.queryByRole("button", { name: "「後で」に保存" })).not.toBeInTheDocument();
  });
});
