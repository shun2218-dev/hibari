import { MessageBody } from "@/components/chat/message-body";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

/** 削除するメッセージを引用して、どれを消すのか取り違えないようにする。 */
export function DeleteMessageDialog({
  open,
  body,
  mentionNames,
  onCancel,
  onConfirm,
  pending,
}: {
  open: boolean;
  /** 保存されている本文。本文と同じ解釈で出す（書式とメンションのチップ。ADR 0051）。 */
  body: string;
  mentionNames?: Readonly<Record<string, string>>;
  onCancel?: () => void;
  onConfirm?: () => void;
  pending?: boolean;
}) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title="メッセージを削除しますか？"
      description="このメッセージは「このメッセージは削除されました」に変わります。添付したファイルも削除されます。元には戻せません。"
      actions={
        <>
          <Button variant="secondary" onClick={onCancel}>
            キャンセル
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={pending}>
            削除する
          </Button>
        </>
      }
    >
      <blockquote className="rounded-r-sm border-l-2 border-border bg-surface-muted px-3.5 py-2.5 text-sm leading-relaxed text-text-secondary">
        <MessageBody body={body} mentionNames={mentionNames} interactive={false} />
      </blockquote>
    </Dialog>
  );
}
