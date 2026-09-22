import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

/**
 * `@channel` / `@here` を送る前の確認（ADR 0043。オーナーの判断。2026-09-19。Slack に合わせる）。
 *
 * ルームの全員に知らせが飛ぶので、書いている途中の `@channel` に自分で気づけないまま送ってしまうのを止める。
 * 個人へのメンションでは出さない。人数は「いま知らせが飛ぶ相手の数」で、`@here` ではオンラインの人数になる。
 */
export function ConfirmMentionAllDialog({
  open,
  kind,
  memberCount,
  onCancel,
  onConfirm,
  pending,
}: {
  open: boolean;
  kind: "channel" | "here";
  /** 知らせが飛ぶ人数。@channel はルームのメンバー、@here はいまオンラインの人。 */
  memberCount: number;
  onCancel?: () => void;
  onConfirm?: () => void;
  pending?: boolean;
}) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={`@${kind} を送りますか？`}
      description={
        kind === "channel"
          ? `このチャンネルのメンバー ${memberCount} 人に知らせが飛びます。`
          : `いまオンラインの ${memberCount} 人に知らせが飛びます。`
      }
      actions={
        <>
          <Button variant="secondary" onClick={onCancel}>
            キャンセル
          </Button>
          <Button onClick={onConfirm} disabled={pending}>
            送信する
          </Button>
        </>
      }
    />
  );
}
