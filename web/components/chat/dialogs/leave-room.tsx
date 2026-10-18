import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

import type { CreatableRoomKind } from "./create-room";

/** 退出したあとに読めるかどうかは公開範囲で変わる（ADR 0011）。設定の画面と確認で同じ文言にする。 */
export function leaveConsequence(kind: CreatableRoomKind): string {
  return kind === "public"
    ? "公開チャンネルなので、退出したあとも読めます。投稿するには、もう一度参加してください。"
    : "非公開チャンネルなので、退出すると読めなくなります。戻るには、メンバーに追加してもらう必要があります。";
}

/** 退出の確認。どのチャンネルから抜けるのかを名前で示す。 */
export function LeaveRoomDialog({
  open,
  kind,
  name,
  pending,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  kind: CreatableRoomKind;
  name: string;
  pending?: boolean;
  onCancel?: () => void;
  onConfirm?: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title="チャンネルを退出しますか？"
      description={`${name} から退出します。${leaveConsequence(kind)}`}
      actions={
        <>
          <Button variant="secondary" onClick={onCancel}>
            キャンセル
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={pending}>
            退出する
          </Button>
        </>
      }
    />
  );
}
