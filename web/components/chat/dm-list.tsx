import { Button, IconButton } from "@/components/ui/button";
import { DmIcon, PlusIcon } from "@/components/ui/icons";

import { RoomRow } from "./sidebar";
import type { RoomSummaryView } from "./types";

type DmListProps = {
  /** DM のルームだけ。最後のメッセージの新しい順（並べるのはデータ層。ADR 0058 決定 7）。 */
  rooms: RoomSummaryView[];
  selectedRoomId?: string;
  roomHref: (roomId: string) => string;
  /** ダイレクトメッセージを始める（相手を選ぶダイアログを開く）。 */
  onStartDm?: () => void;
};

/**
 * 左のメニューの「DM」（ADR 0058 決定 7。Slack の「DM」）。サイドバーの列に出し、相手ごとに最後のメッセージを添えて新しい順に並べる。
 * 行はホームのサイドバーの DM の行と同じもの（アバター・presence・未読の太字・未読数）。
 */
export function DmList({ rooms, selectedRoomId, roomHref, onStartDm }: DmListProps) {
  return (
    <section aria-labelledby="dm-list-title" className="flex h-full flex-col bg-surface">
      <header className="flex h-16 shrink-0 items-center justify-between gap-2 pr-2.5 pl-4">
        <h1 id="dm-list-title" className="text-xl font-bold text-text">
          ダイレクトメッセージ
        </h1>
        <IconButton label="ダイレクトメッセージを開く" onClick={onStartDm}>
          <PlusIcon className="size-4" />
        </IconButton>
      </header>
      {rooms.length === 0 ? (
        <div className="flex flex-col items-center gap-1 px-4 pt-12 text-center">
          <DmIcon className="size-6 text-text-muted" />
          <p className="pt-1 text-base font-medium text-text">ダイレクトメッセージはまだありません</p>
          <p className="text-xs leading-relaxed text-text-muted">ワークスペースのメンバーと 1 対 1 で話せます</p>
          <Button onClick={onStartDm} className="mt-4">
            ダイレクトメッセージを開く
          </Button>
        </div>
      ) : (
        <ul aria-label="ダイレクトメッセージ" className="min-h-0 flex-1 overflow-y-auto pb-4">
          {rooms.map((room) => (
            <RoomRow key={room.id} room={room} href={roomHref(room.id)} selected={room.id === selectedRoomId} />
          ))}
        </ul>
      )}
    </section>
  );
}
