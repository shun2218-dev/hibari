import type { ReactNode } from "react";

import { Button, IconButton, TextButton } from "@/components/ui/button";
import { ArchiveIcon, CloseIcon } from "@/components/ui/icons";

import type { RoomKind } from "./types";

function roomLabel(kind: RoomKind, name: string): string {
  return kind === "public" ? `# ${name}` : name;
}

/** メッセージ領域の中央に置く、見出しと説明（と操作）。 */
function CenteredNotice({ title, description, action }: { title: ReactNode; description: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
      <h2 className="text-lg font-bold text-text">{title}</h2>
      <p className="max-w-88 text-sm leading-relaxed text-text-secondary">{description}</p>
      {action && <div className="pt-3">{action}</div>}
    </div>
  );
}

export function EmptyMessages({ kind, name }: { kind: RoomKind; name: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
      <p className="text-lg font-medium text-text">{roomLabel(kind, name)} のはじまりです</p>
      <p className="text-sm text-text-muted">最初のメッセージを送ってみてください</p>
    </div>
  );
}

/**
 * 開いている非公開チャンネル（と DM）を読めなくなった（room.member_removed。ADR 0035）。履歴も隠す。
 *
 * 外されたことも、チャンネルの名前も言わない。非公開チャンネルは名前も含めてメンバーだけのものなので、
 * 読めなくなった人には「存在しない」と区別できない形で出す（API が 404 で両者を区別しないのと同じ。ADR 0011）。
 */
export function RoomUnavailable({ onBack }: { onBack?: () => void }) {
  return (
    <CenteredNotice
      title="このチャンネルにはアクセスできません"
      description="チャンネルが存在しないか、閲覧する権限がありません。"
      action={<Button onClick={onBack}>チャンネル一覧に戻る</Button>}
    />
  );
}

/** ワークスペースからキックされた（workspace.member_removed）。 */
export function RemovedFromWorkspace({ workspaceName, onMove }: { workspaceName: string; onMove?: () => void }) {
  return (
    <CenteredNotice
      title="ワークスペースから削除されました"
      description={`「${workspaceName}」のメンバーではなくなったため、このワークスペースのチャンネルは表示できません。`}
      action={<Button onClick={onMove}>別のワークスペースに移動</Button>}
    />
  );
}

/**
 * 未読が、読み込んだページより古いときに出すバー（ADR 0042）。タイムラインの上端に、接続状態のバナーと同じ形で置く。
 *
 * 未読が最初のページの中にあるときは「ここから未読」の線が見えているので、このバーは出さない。
 * 件数は「いま起きていること」なので琥珀、飛ぶのは押せる操作なので緑にする（docs/ui/tokens.md）。
 */
export function UnreadJumpBar({ count, onJump }: { count: number; onJump?: () => void }) {
  return (
    <div className="flex h-9 shrink-0 items-center justify-center gap-3 border-b border-border bg-attention-subtle px-4">
      <p className="text-xs font-semibold text-attention-text">未読 {count} 件</p>
      <TextButton onClick={onJump} className="text-xs">
        最初の未読へ
      </TextButton>
    </div>
  );
}

/**
 * リンクで指されたメッセージが見つからなかった（ADR 0042）。最新のページを出したうえで、控えめに 1 行だけ知らせる。
 *
 * ない・読めない・削除済みを区別しないので、理由は書かない（区別できると、リンクを貼るだけで実在を当てられる。ADR 0040）。
 * 読み続けている間ずっと残ると邪魔なので、閉じられるようにする。
 */
export function MessageNotFoundNotice({ onClose }: { onClose?: () => void }) {
  return (
    <div className="relative flex h-9 shrink-0 items-center justify-center border-b border-border bg-surface-muted px-4">
      <p role="status" className="text-xs text-text-muted">
        そのメッセージは見つかりませんでした
      </p>
      <IconButton label="知らせを閉じる" muted onClick={onClose} className="absolute right-2 size-7">
        <CloseIcon className="size-3.5" />
      </IconButton>
    </div>
  );
}

/**
 * public ルームを参加せずに読んでいるときの、入力欄の代わり。
 * 読むのに参加は要らないが、投稿するには参加が要る（CLAUDE.md「閲覧権限」）。
 */
export function JoinRoomBar({ joining, onJoin }: { joining?: boolean; onJoin?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-border px-4 py-2.5">
      <p className="text-sm text-text-secondary">このチャンネルに参加すると投稿できます</p>
      <Button onClick={onJoin} disabled={joining}>
        参加する
      </Button>
    </div>
  );
}

/**
 * アーカイブされたルームの入力欄の代わり（ADR 0059）。読めるが、投稿・リアクションなどはできない。
 * 復元できるのはルームのメンバー（と admin 以上）なので、`onRestore` を渡したときだけボタンを出す。
 */
export function ArchivedRoomBar({ restoring, onRestore }: { restoring?: boolean; onRestore?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-border bg-surface-muted px-4 py-2.5">
      <p className="flex items-center gap-2 text-sm text-text-secondary">
        <ArchiveIcon className="size-4 shrink-0" />
        アーカイブされたチャンネルです。投稿やリアクションはできません。
      </p>
      {onRestore && (
        <Button variant="secondary" onClick={onRestore} disabled={restoring} className="shrink-0">
          チャンネルを復元
        </Button>
      )}
    </div>
  );
}

/**
 * API に届かない。端末のネットワークが切れているとき（ブラウザがオフライン）はこの画面にせず、
 * 再接続中のバナーで待つ。
 */
export function ServerUnavailable({
  lastConnectedLabel,
  retryCount,
  retrying,
  onRetry,
}: {
  lastConnectedLabel: string;
  retryCount: number;
  retrying?: boolean;
  onRetry?: () => void;
}) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-2 bg-background px-6 text-center">
      <h1 className="text-xl font-bold text-text">サーバーに接続できません</h1>
      <p className="max-w-105 text-sm leading-relaxed text-text-secondary">
        端末はネットワークに接続していますが、hibari のサーバーから応答がありません。
      </p>
      <p className="font-mono text-2xs text-text-muted">
        最終接続 {lastConnectedLabel} · 再試行 {retryCount}回
      </p>
      <div className="pt-3">
        <Button onClick={onRetry} disabled={retrying}>
          再試行
        </Button>
      </div>
    </main>
  );
}
