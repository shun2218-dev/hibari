import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

import { MemberPicker } from "./member-picker";
import type { DmCandidateView } from "./start-dm";

/**
 * 非公開チャンネルに追加する相手を選ぶ（`RoomSettingsDialog` の「メンバーを追加」から開く）。
 * 候補はワークスペースのメンバーのうち、まだこのチャンネルにいない人だけ。ひとりずつ追加する。
 */
export function AddRoomMemberDialog({
  open,
  candidates,
  selectedId,
  search = "",
  onSearchChange,
  onSelect,
  onCancel,
  onAdd,
  adding,
}: {
  open: boolean;
  candidates: DmCandidateView[];
  selectedId?: string;
  search?: string;
  onSearchChange?: (value: string) => void;
  onSelect?: (userId: string) => void;
  onCancel?: () => void;
  onAdd?: () => void;
  adding?: boolean;
}) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      width="wide"
      title="メンバーを追加"
      description="このチャンネルに追加する人を選んでください。参加前の履歴も読めるようになります。"
      actions={
        <>
          <Button variant="secondary" onClick={onCancel}>
            キャンセル
          </Button>
          <Button onClick={onAdd} disabled={adding || !selectedId}>
            追加する
          </Button>
        </>
      }
    >
      <MemberPicker
        name="add-member"
        candidates={candidates}
        selectedId={selectedId}
        search={search}
        onSearchChange={onSearchChange}
        onSelect={onSelect}
        emptyText="追加できる人がいません。ワークスペースの全員がこのチャンネルにいます。"
      />
    </Dialog>
  );
}
