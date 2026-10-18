import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

/** アーカイブで何が変わるか（ADR 0059）。設定の画面と確認で同じ文言にする。 */
export const ARCHIVE_CONSEQUENCE =
  "誰も投稿やリアクションができなくなり、サイドバーから外れます。履歴は残り、検索から開けます。あとで復元できます。";

/** アーカイブの確認（ADR 0059）。戻せるので、チェックは要らない。 */
export function ArchiveRoomDialog({
  open,
  name,
  pending,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  name: string;
  pending?: boolean;
  onCancel?: () => void;
  onConfirm?: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title="チャンネルをアーカイブしますか？"
      description={`${name} をアーカイブします。${ARCHIVE_CONSEQUENCE}`}
      actions={
        <>
          <Button variant="secondary" onClick={onCancel}>
            キャンセル
          </Button>
          <Button onClick={onConfirm} disabled={pending}>
            アーカイブする
          </Button>
        </>
      }
    />
  );
}
