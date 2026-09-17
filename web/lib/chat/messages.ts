import type { Message } from "@/lib/api/types.gen";

/**
 * 手元のメッセージに、取得したメッセージを合わせる。
 *
 * - 並びは seq の昇順だけで決める（created_at を使わない。CLAUDE.md ルール 3）
 * - 同じメッセージが 2 回届いたら、change_seq の大きい方（新しい編集・削除を反映した方）を残す。
 *   REST のページと、構築順 3 の WebSocket のイベントが前後して届いても、古い内容で上書きしない
 *
 * 入力の配列は変更せず、新しい配列を返す（useSyncExternalStore のスナップショットとして比較できるように）。
 */
export function mergeMessages(current: readonly Message[], incoming: readonly Message[]): Message[] {
  const byId = new Map<string, Message>();
  for (const message of current) byId.set(message.id, message);
  for (const message of incoming) {
    const existing = byId.get(message.id);
    if (!existing || existing.change_seq <= message.change_seq) byId.set(message.id, message);
  }
  return [...byId.values()].sort((a, b) => a.seq - b.seq);
}
