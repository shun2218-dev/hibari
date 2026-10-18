import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

/** 削除で何が消えるか（ADR 0059）。戻せないので、残したいだけならアーカイブを勧める。 */
export const DELETE_CONSEQUENCE =
  "メッセージとファイルがすべて完全に削除され、元に戻せません。残しておきたいだけなら、アーカイブを使ってください。";

/**
 * 削除の確認（ADR 0059）。戻せないので、Slack と同じく「はい、完全に削除します」にチェックを入れるまで押せない。
 * チェックは開くたびに外れた状態から始める（閉じると中身ごと外れるので、状態はこの中に持てば足りる）。
 */
export function DeleteRoomDialog({
  open,
  name,
  pending,
  defaultConfirmed = false,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  name: string;
  pending?: boolean;
  /** story でチェックを入れた状態を見せるためだけに使う。 */
  defaultConfirmed?: boolean;
  onCancel?: () => void;
  onConfirm?: () => void;
}) {
  if (!open) return null;
  return (
    <DeleteRoomDialogBody
      name={name}
      pending={pending}
      defaultConfirmed={defaultConfirmed}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}

function DeleteRoomDialogBody({
  name,
  pending,
  defaultConfirmed,
  onCancel,
  onConfirm,
}: {
  name: string;
  pending?: boolean;
  defaultConfirmed: boolean;
  onCancel?: () => void;
  onConfirm?: () => void;
}) {
  const [confirmed, setConfirmed] = useState(defaultConfirmed);
  return (
    <Dialog
      open
      onClose={onCancel}
      title="チャンネルを削除しますか？"
      description={`${name} を削除します。${DELETE_CONSEQUENCE}`}
      actions={
        <>
          <Button variant="secondary" onClick={onCancel}>
            キャンセル
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={!confirmed || pending}>
            チャンネルを削除する
          </Button>
        </>
      }
    >
      <label className="flex cursor-pointer items-center gap-2 text-sm text-text">
        {/* 本物の checkbox を使い、キーボード操作と読み上げはブラウザに任せる（入力欄の「チャンネルにも投稿する」と同じ） */}
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="size-4 cursor-pointer accent-danger"
        />
        はい、完全に削除します
      </label>
    </Dialog>
  );
}
