import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

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
  },
  {
    key: "t2",
    room: { kind: "private", name: "リリース準備" },
    root: { sender: naoki, timeLabel: "昨日", body: "", deleted: true },
    replyCount: 2,
    lastReplyLabel: "昨日",
    unreadCount: 0,
  },
];

describe("ThreadList", () => {
  it("lists threads in the given order, each linking to its thread", () => {
    render(<ThreadList threads={threads} threadHref={(key) => `/threads/${key}`} />);

    const links = within(screen.getByRole("list", { name: "参加しているスレッド" })).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/threads/t1", "/threads/t2"]);
    expect(links[0]).toHaveTextContent("デザインレビュー");
    expect(links[0]).toHaveTextContent("未読まわりを琥珀に寄せてみました。");
    expect(links[0]).toHaveTextContent("3 件の返信");
    expect(links[0]).toHaveTextContent("最終返信 10:18");
  });

  it("shows the unread count only for threads with unread replies", () => {
    render(<ThreadList threads={threads} threadHref={() => "#"} />);

    const [first, second] = screen.getAllByRole("link");
    expect(within(first).getByLabelText("未読 1 件")).toBeInTheDocument();
    expect(within(second).queryByLabelText(/未読/)).not.toBeInTheDocument();
  });

  it("does not show the body of a deleted root", () => {
    render(<ThreadList threads={threads} threadHref={() => "#"} />);

    const second = screen.getAllByRole("link")[1];
    expect(second).toHaveTextContent("このメッセージは削除されました");
    expect(within(second).getByRole("img", { name: "非公開チャンネル" })).toBeInTheDocument();
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

    const row = screen.getByRole("link");
    expect(within(row).getByText("確認").tagName).toBe("STRONG");
    expect(within(row).getByText(`@${naoki.name}`)).toBeInTheDocument();
    // 行の中にリンクやボタンを入れ子にしない
    expect(within(row).queryByRole("link")).not.toBeInTheDocument();
    expect(within(row).queryByRole("button")).not.toBeInTheDocument();
  });
});
