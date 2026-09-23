import type { Search } from "@/lib/api/types.gen";
import type { Session } from "@/lib/auth/session/auth-session";
import type { SearchQuery } from "@/lib/chat/search/search-query";

/** 検索の 1 ページの件数（サーバーの上限は 50。ADR 0061 決定 8）。 */
export const SEARCH_PAGE_SIZE = 20;

/**
 * メッセージの検索（ADR 0061）。
 *
 * 修飾子はクライアントが解釈して ID と日時にしてから渡す（決定 5）。ここでは名前を送らない。
 */
export function createSearchApi(request: Session["request"]) {
  return {
    /** 新しい順に 1 ページ。cursor は前のページの next_cursor。 */
    searchMessages: (workspaceId: string, query: SearchQuery, cursor?: string) => {
      const params = new URLSearchParams({ q: query.text, limit: String(SEARCH_PAGE_SIZE) });
      if (query.room) params.set("room_id", query.room.id);
      if (query.sender) params.set("sender_id", query.sender.id);
      // 日付は端末の時間帯で解釈する（決定 5）。`before` はその日を含むので、翌日の 0 時にして「未満」に合わせる
      if (query.after !== undefined) params.set("after", startOfDay(query.after));
      if (query.before !== undefined) params.set("before", startOfNextDay(query.before));
      if (cursor !== undefined) params.set("cursor", cursor);
      return request<Search>("GET", `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/search/messages?${params}`);
    },
  };
}

/** `YYYY-MM-DD` を、端末の時間帯のその日の 0 時（RFC 3339）にする。 */
function startOfDay(date: string): string {
  return atLocalMidnight(date, 0);
}

function startOfNextDay(date: string): string {
  return atLocalMidnight(date, 1);
}

function atLocalMidnight(date: string, plusDays: number): string {
  const [year, month, day] = date.split("-").map(Number);
  // Date のコンストラクタは端末の時間帯で作る。日をまたぐ繰り上がりも任せられる
  const at = new Date(year, month - 1, day + plusDays);
  const offset = -at.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const pad = (n: number) => String(Math.abs(n)).padStart(2, "0");
  return (
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}` +
    `T${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}` +
    `${sign}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`
  );
}
