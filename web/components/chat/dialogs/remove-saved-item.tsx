import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

/**
 * 読めない保存を「後で」から外す（ADR 0054 決定 8）。中身が見えないまま外すことになるので、押したら確かめる（Slack と同じ）。
 * 外すのは本人の保存の行だけで、メッセージには触れない。
 */
export function RemoveSavedItemDialog({
  open,
  onCancel,
  onConfirm,
  pending,
}: {
  open: boolean;
  onCancel?: () => void;
  onConfirm?: () => void;
  pending?: boolean;
}) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title="「後で」から外しますか？"
      description="このメッセージは表示できません（削除されたか、読めなくなりました）。「後で」の一覧から外します。"
      actions={
        <>
          <Button variant="secondary" onClick={onCancel}>
            キャンセル
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={pending}>
            外す
          </Button>
        </>
      }
    />
  );
}
