import type { SearchResultView } from "@/components/chat/types";
import type { SearchResult } from "@/lib/api/types.gen";
import { permalinkPath, withSide } from "@/lib/chat/format/links";
import { formatListTime } from "@/lib/chat/format/time";
import type { UrlTable } from "@/lib/chat/views/message";

/**
 * 検索結果の 1 件（ADR 0061 決定 7）。
 *
 * 押したときの行き先は 6.11 のパーマリンク（ADR 0042）。スレッドの返信なら `t=` を付けるので、
 * 飛んだ先でスレッドが開く。読めるかどうかは飛んだ先でもう一度判定されるので、
 * 結果が古くなっていても権限は漏れない。
 */
export function toSearchResultView(
  result: SearchResult,
  workspaceId: string,
  {
    now = new Date(),
    timeZone,
    avatarUrls = {},
    memberNames,
    side,
  }: {
    now?: Date;
    timeZone?: string;
    avatarUrls?: UrlTable;
    /** 本文の `<@ID>` に使う表示名（ワークスペースのメンバー一覧から）。 */
    memberNames?: Readonly<Record<string, string>>;
    /** 行き先の URL に残す左のメニュー（ADR 0058 決定 1）。 */
    side?: string;
  } = {},
): SearchResultView {
  const threadRootId = result.thread_root_id ?? undefined;
  const href = permalinkPath({
    workspaceId,
    roomId: result.room_id,
    messageId: result.id,
    ...(threadRootId ? { threadRootId } : {}),
  });
  return {
    key: result.id,
    href: side ? withSide(href, side) : href,
    room: {
      kind: result.room.kind,
      // dm にはルーム名がないので、相手の表示名を出す
      name: result.room.kind === "dm" ? (result.room.dm_peer?.display_name ?? "") : result.room.name,
    },
    sender: {
      id: result.sender.id,
      name: result.sender.display_name,
      avatarUrl: avatarUrls[result.sender.id] ?? undefined,
    },
    timeLabel: formatListTime(new Date(result.created_at), now, timeZone),
    body: result.body,
    mentionNames: memberNames,
    inThread: threadRootId !== undefined,
    attachmentCount: result.attachment_count,
  };
}
