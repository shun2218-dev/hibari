import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FileIcon } from "@/components/ui/icons";

/**
 * 添付ファイルだけを削除する確認（ADR 0045 決定 9）。取り消せないので、楽観的更新はせずここで確かめる。
 *
 * これが最後の添付で本文も空なら、メッセージごと消える（ADR 0045 決定 8）。
 * 消える範囲が変わるので、`alsoDeletesMessage` で文言を変えて先に伝える。
 */
export function DeleteAttachmentDialog({
  open,
  fileName,
  alsoDeletesMessage = false,
  onCancel,
  onConfirm,
  pending,
}: {
  open: boolean;
  fileName: string;
  alsoDeletesMessage?: boolean;
  onCancel?: () => void;
  onConfirm?: () => void;
  pending?: boolean;
}) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={alsoDeletesMessage ? "メッセージごと削除しますか？" : "ファイルを削除しますか？"}
      description={
        alsoDeletesMessage
          ? "これがこのメッセージの最後の添付で、本文もありません。削除するとメッセージごと消えて、タイムラインからもなくなります。元には戻せません。"
          : "このファイルだけを削除します。メッセージと本文は残ります。元には戻せません。"
      }
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
      <div className="flex items-center gap-3 rounded-md border border-border bg-surface-muted px-3.5 py-2.5">
        <FileIcon className="size-4.5 shrink-0 text-text-secondary" />
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-text">{fileName}</p>
      </div>
    </Dialog>
  );
}
