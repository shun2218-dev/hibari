import { MessageIcon, PinIcon } from "@/components/ui/icons";
import { Tabs } from "@/components/ui/tabs";

/** ルームの本文に出すもの（Slack のヘッダーの下のタブ。ADR 0054 決定 11 の追記）。 */
export type RoomTab = "messages" | "pins";

const ITEMS = [
  { value: "messages", label: "メッセージ", icon: MessageIcon },
  { value: "pins", label: "ピン", icon: PinIcon },
] as const;

/**
 * ルームのヘッダーの下の「メッセージ / ピン」（Slack と同じ）。ピン留めの一覧はタイムラインの代わりにメインの領域に出す。
 * 件数は出さない（Slack と同じ。開けば分かる）。
 */
export function RoomTabs({ value, onChange }: { value: RoomTab; onChange?: (tab: RoomTab) => void }) {
  return (
    <div className="shrink-0 border-b border-border px-3 md:px-4">
      <Tabs label="ルームの表示" items={ITEMS} value={value} onChange={onChange} bordered={false} />
    </div>
  );
}
