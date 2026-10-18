import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ThreadList } from "./thread-list";
import type { ThreadListItemView } from "./types";

const naoki = { id: "01J8ZH5K000000000000000002", name: "佐藤 直樹" };

const threads: ThreadListItemView[] = [
  {
    key: "t1",
    room: { kind: "public", name: "デザインレビュー" },
    root: { sender: naoki, timeLabel: "09:41", body: "未読まわりを琥珀に寄せてみました。", deleted: false },
    replyCount: 3,
    lastReplyLabel: "10:18",
    unreadCount: 1,
    notifyReplies: true,
    mentionCount: 0,
  },
  {
    key: "t2",
    room: { kind: "private", name: "リリース準備" },
    root: { sender: naoki, timeLabel: "昨日", body: "", deleted: true },
    replyCount: 2,
    lastReplyLabel: "昨日",
    unreadCount: 0,
    notifyReplies: true,
    mentionCount: 0,
  },
];

describe("ThreadList", () => {
  it("lists threads in the given order, each linking to its thread", () => {
    render(<ThreadList threads={threads} threadHref={(key) => `/threads/${key}`} />);

    const list = within(screen.getByRole("list", { name: "参加しているスレッド" }));
    const links = list.getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/threads/t1", "/threads/t2"]);
    expect(links[0]).toHaveAccessibleName("佐藤 直樹 のスレッドを開く");
    const row = list.getAllByRole("listitem")[0];
    expect(row).toHaveTextContent("デザインレビュー");
    expect(row).toHaveTextContent("未読まわりを琥珀に寄せてみました。");
    expect(row).toHaveTextContent("3 件の返信");
    expect(row).toHaveTextContent("最終返信 10:18");
  });

  it("shows the unread count only for threads with unread replies", () => {
    render(<ThreadList threads={threads} threadHref={() => "#"} />);

    const [first, second] = screen.getAllByRole("listitem");
    expect(within(first).getByLabelText("未読 1 件")).toBeInTheDocument();
    expect(within(second).queryByLabelText(/未読/)).not.toBeInTheDocument();
  });

  it("does not show the body of a deleted root", () => {
    render(<ThreadList threads={threads} threadHref={() => "#"} />);

    const second = screen.getAllByRole("listitem")[1];
    expect(second).toHaveTextContent("このメッセージは削除されました");
    expect(within(second).getByRole("img", { name: "非公開チャンネル" })).toBeInTheDocument();
  });

  it("返信の通知をオフにした行は未読を強調せず、メンションの数だけ出す（ADR 0056 決定 2）", () => {
    render(
      <ThreadList
        threads={[
          { ...threads[0], notifyReplies: false, unreadCount: 3, mentionCount: 0 },
          { ...threads[1], notifyReplies: false, unreadCount: 2, mentionCount: 1 },
        ]}
        threadHref={() => "#"}
      />,
    );

    const [first, second] = screen.getAllByRole("listitem");
    expect(within(first).queryByLabelText(/未読/)).not.toBeInTheDocument();
    expect(within(first).getByRole("img", { name: "返信の通知はオフ" })).toBeInTheDocument();
    expect(within(first).getByText("3 件の返信")).not.toHaveClass("text-text");
    expect(within(second).getByLabelText("メンション 1 件")).toHaveTextContent("@1");
  });

  it("行の「その他」から返信の通知を切り替える", async () => {
    const onToggleNotify = vi.fn();
    const { rerender } = render(
      <ThreadList threads={threads} threadHref={() => "#"} onToggleNotify={onToggleNotify} openMenuKey="t1" />,
    );

    await userEvent.click(screen.getByRole("button", { name: "返信の通知をオフにする" }));
    expect(onToggleNotify).toHaveBeenCalledWith("t1");

    rerender(
      <ThreadList
        threads={[{ ...threads[0], notifyReplies: false }]}
        threadHref={() => "#"}
        onToggleNotify={onToggleNotify}
        openMenuKey="t1"
      />,
    );
    expect(screen.getByRole("button", { name: "新しい返信の通知を受け取る" })).toBeInTheDocument();
  });

  it("切り替えを渡さなければ「その他」を出さない", () => {
    render(<ThreadList threads={threads} threadHref={() => "#"} />);

    expect(screen.queryByRole("button", { name: "その他の操作" })).not.toBeInTheDocument();
  });

  it("explains when to expect threads when there are none", () => {
    render(<ThreadList threads={[]} threadHref={() => "#"} />);

    expect(screen.getByText("参加しているスレッドはありません")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("親の本文は書式を解釈し、行のリンクの中なのでリンクもチップも押せない要素で描く（ADR 0051）", () => {
    const withFormat: ThreadListItemView = {
      ...threads[0],
      root: {
        ...threads[0].root,
        body: `*確認* お願いします <@${naoki.id}> https://example.com`,
        mentionNames: { [naoki.id]: naoki.name },
      },
    };
    render(<ThreadList threads={[withFormat]} threadHref={() => "/threads/t1"} />);

    const row = screen.getByRole("listitem");
    expect(within(row).getByText("確認").tagName).toBe("STRONG");
    expect(within(row).getByText(`@${naoki.name}`)).toBeInTheDocument();
    // 本文のリンクとチップは押せる要素にしない。行のリンクは本文の外に重ねた 1 つだけ
    expect(within(row).getAllByRole("link")).toHaveLength(1);
    expect(within(row).getByRole("link")).toBeEmptyDOMElement();
    expect(within(row).queryByRole("button")).not.toBeInTheDocument();
  });
});
