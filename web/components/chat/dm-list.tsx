import { Button, IconButton } from "@/components/ui/button";
import { DmIcon, PlusIcon } from "@/components/ui/icons";
import { Switch } from "@/components/ui/switch";
import { cx } from "@/lib/cx";

import { RoomRow } from "./sidebar";
import type { RoomSummaryView } from "./types";

type DmListProps = {
  /** DM のルームだけ。最後のメッセージの新しい順（並べるのはデータ層。ADR 0058 決定 7）。 */
  rooms: RoomSummaryView[];
  selectedRoomId?: string;
  roomHref: (roomId: string) => string;
  /** ダイレクトメッセージを始める（相手を選ぶダイアログを開く）。 */
  onStartDm?: () => void;
  /**
   * 「未読メッセージ」のスイッチ（Slack と同じ。ADR 0058 の追記）。オンなら未読のある DM だけを出す。
   * 絞るのは手元のルーム一覧なので、呼ぶ側が絞った rooms を渡す。
   */
  unreadOnly?: boolean;
  onToggleUnreadOnly?: () => void;
  /** pane はサイドバーの列、preview は左のメニューにポインタを乗せたときに重ねて出す形（見出しの右にスイッチ）。 */
  variant?: "pane" | "preview";
};

/**
 * 左のメニューの「DM」（ADR 0058 決定 7。Slack の「DM」）。サイドバーの列に出し、相手ごとに最後のメッセージを添えて新しい順に並べる。
 * 行はホームのサイドバーの DM の行と同じもの（アバター・presence・未読の太字・未読数）。
 */
export function DmList({
  rooms,
  selectedRoomId,
  roomHref,
  onStartDm,
  unreadOnly = false,
  onToggleUnreadOnly,
  variant = "pane",
}: DmListProps) {
  const preview = variant === "preview";
  const unreadSwitch = <Switch label="未読メッセージ" checked={unreadOnly} onChange={() => onToggleUnreadOnly?.()} />;
  return (
    <section aria-labelledby={`dm-list-title-${variant}`} className="flex h-full flex-col bg-surface">
      <header
        className={cx("flex shrink-0 items-center justify-between gap-2 pl-4", preview ? "h-14 border-b border-border pr-4" : "h-16 pr-2.5")}
      >
        <h1 id={`dm-list-title-${variant}`} className={cx("font-bold text-text", preview ? "text-lg" : "text-xl")}>
          ダイレクトメッセージ
        </h1>
        {preview ? (
          unreadSwitch
        ) : (
          <IconButton label="ダイレクトメッセージを開く" onClick={onStartDm}>
            <PlusIcon className="size-4" />
          </IconButton>
        )}
      </header>
      {/* 見出しの右にはサイドバーの幅では収まらないので、一覧の上に置く（アクティビティと同じ） */}
      {!preview && <div className="flex shrink-0 justify-end px-4 pb-2">{unreadSwitch}</div>}
      {rooms.length === 0 && unreadOnly ? (
        <div className="flex flex-col items-center gap-1 px-4 pt-12 text-center">
          <p className="text-base font-medium text-text">未読のダイレクトメッセージはありません</p>
          <p className="text-xs leading-relaxed text-text-muted">「未読メッセージ」を外すと、すべての DM が並びます</p>
        </div>
      ) : rooms.length === 0 ? (
        <div className="flex flex-col items-center gap-1 px-4 pt-12 text-center">
          <DmIcon className="size-6 text-text-muted" />
          <p className="pt-1 text-base font-medium text-text">ダイレクトメッセージはまだありません</p>
          <p className="text-xs leading-relaxed text-text-muted">ワークスペースのメンバーと 1 対 1 で話せます</p>
          <Button onClick={onStartDm} className="mt-4">
            ダイレクトメッセージを開く
          </Button>
        </div>
      ) : (
        <ul aria-label="ダイレクトメッセージ" className={cx("min-h-0 flex-1 overflow-y-auto pb-4", preview && "pt-1")}>
          {rooms.map((room) => (
            <RoomRow key={room.id} room={room} href={roomHref(room.id)} selected={room.id === selectedRoomId} />
          ))}
        </ul>
      )}
    </section>
  );
}
