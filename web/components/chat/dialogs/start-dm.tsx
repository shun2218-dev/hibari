import type { UserRef } from "@/components/chat/types";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { PresenceView } from "@/lib/chat/presence";

import { MemberPicker } from "./member-picker";

export type DmCandidateView = UserRef & { handle: string; presence: PresenceView };

/**
 * DM の相手を選ぶ。相手はワークスペースのメンバーだけで、ひとりだけ選べる
 * （グループ DM はスコープ外、メンバーの追加もできない）。すでにある DM なら、それを開く。
 */
export function StartDmDialog({
  open,
  candidates,
  selectedId,
  search = "",
  onSearchChange,
  onSelect,
  onCancel,
  onOpen,
  opening,
}: {
  open: boolean;
  candidates: DmCandidateView[];
  selectedId?: string;
  search?: string;
  onSearchChange?: (value: string) => void;
  onSelect?: (userId: string) => void;
  onCancel?: () => void;
  onOpen?: () => void;
  opening?: boolean;
}) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      width="wide"
      title="ダイレクトメッセージ"
      description="相手を選んでください。同じ相手とのダイレクトメッセージは 1 つにまとまります。"
      actions={
        <>
          <Button variant="secondary" onClick={onCancel}>
            キャンセル
          </Button>
          <Button onClick={onOpen} disabled={opening || !selectedId}>
            開く
          </Button>
        </>
      }
    >
      <MemberPicker
        name="dm-peer"
        candidates={candidates}
        selectedId={selectedId}
        search={search}
        onSearchChange={onSearchChange}
        onSelect={onSelect}
        emptyText="ほかにメンバーがいません。招待リンクで誰かを招待してください。"
      />
    </Dialog>
  );
}
