import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

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
 * 非公開チャンネルから外された（room.member_removed）。以降のメッセージは届かないので、履歴も隠す。
 */
export function RemovedFromRoom({ kind, name, onBack }: { kind: RoomKind; name: string; onBack?: () => void }) {
  return (
    <CenteredNotice
      title="このチャンネルから外されました"
      description={`「${roomLabel(kind, name)}」のメンバーではなくなったため、以降のメッセージは表示されません。`}
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
