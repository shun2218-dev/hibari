import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { RadioCard } from "@/components/ui/choice";
import { Dialog } from "@/components/ui/dialog";

import { roleLabel, type WorkspaceRole } from "./types";

type ConfirmProps = { open: boolean; pending?: boolean; onCancel?: () => void; onConfirm?: () => void };

export function KickMemberDialog({ memberName, ...props }: ConfirmProps & { memberName: string }) {
  return (
    <Dialog
      open={props.open}
      onClose={props.onCancel}
      title="メンバーを削除しますか？"
      description={`${memberName} さんをこのワークスペースから削除します。参加中のチャンネルからも外れ、過去の発言は残ります。再び参加するには招待リンクが必要です。`}
      actions={
        <>
          <Button variant="secondary" onClick={props.onCancel}>
            キャンセル
          </Button>
          <Button variant="danger" onClick={props.onConfirm} disabled={props.pending}>
            削除する
          </Button>
        </>
      }
    />
  );
}

export function LeaveWorkspaceDialog({ workspaceName, ...props }: ConfirmProps & { workspaceName: string }) {
  return (
    <Dialog
      open={props.open}
      onClose={props.onCancel}
      title="ワークスペースを退出しますか？"
      description={`${workspaceName} から退出します。参加中のチャンネルからも外れます。再び参加するには招待リンクが必要です。`}
      actions={
        <>
          <Button variant="secondary" onClick={props.onCancel}>
            キャンセル
          </Button>
          <Button variant="danger" onClick={props.onConfirm} disabled={props.pending}>
            退出する
          </Button>
        </>
      }
    />
  );
}

/** オーナーは譲渡するまで退出できない（ADR 0011）。 */
export function LeaveBlockedDialog({
  open,
  onClose,
  onTransfer,
}: {
  open: boolean;
  onClose?: () => void;
  onTransfer?: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="先にオーナーを譲渡してください"
      description="あなたはこのワークスペースのオーナーです。オーナーはワークスペースにひとりだけなので、他のメンバーに譲渡するまで退出できません。"
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            閉じる
          </Button>
          <Button onClick={onTransfer}>オーナーを譲渡</Button>
        </>
      }
    />
  );
}

export type TransferCandidate = {
  id: string;
  name: string;
  handle: string;
  avatarUrl?: string;
  role: Exclude<WorkspaceRole, "owner">;
};

export function TransferOwnershipPickDialog({
  open,
  candidates,
  selectedId,
  onSelect,
  onCancel,
  onNext,
}: {
  open: boolean;
  candidates: TransferCandidate[];
  selectedId?: string;
  onSelect?: (userId: string) => void;
  onCancel?: () => void;
  onNext?: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      width="wide"
      title="オーナーを譲渡"
      description="譲渡先のメンバーを選んでください。オーナーは常にひとりです。"
      actions={
        <>
          <Button variant="secondary" onClick={onCancel}>
            キャンセル
          </Button>
          <Button onClick={onNext} disabled={!selectedId}>
            次へ
          </Button>
        </>
      }
    >
      <fieldset className="-mx-1 flex max-h-66 flex-col gap-2 overflow-y-auto px-1">
        <legend className="sr-only">譲渡先</legend>
        {candidates.map((candidate) => (
          <RadioCard
            key={candidate.id}
            name="transfer-to"
            value={candidate.id}
            checked={candidate.id === selectedId}
            onChange={onSelect}
            leading={<Avatar id={candidate.id} name={candidate.name} imageUrl={candidate.avatarUrl} size="sm" />}
            title={candidate.name}
            description={<span className="font-mono">@{candidate.handle}</span>}
            trailing={<span className="text-2xs text-text-secondary">{roleLabel[candidate.role]}</span>}
          />
        ))}
      </fieldset>
    </Dialog>
  );
}

export function TransferOwnershipConfirmDialog({
  newOwnerName,
  workspaceName,
  ...props
}: ConfirmProps & { newOwnerName: string; workspaceName: string }) {
  return (
    <Dialog
      open={props.open}
      onClose={props.onCancel}
      title="オーナーを譲渡しますか？"
      description={`${newOwnerName} さんが ${workspaceName} のオーナーになります。あなたは管理者になります。この操作は新しいオーナーだけが元に戻せます。`}
      actions={
        <>
          <Button variant="secondary" onClick={props.onCancel}>
            キャンセル
          </Button>
          <Button onClick={props.onConfirm} disabled={props.pending}>
            譲渡する
          </Button>
        </>
      }
    />
  );
}
