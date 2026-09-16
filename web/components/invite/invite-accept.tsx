import { StatusContent } from "@/components/auth/auth-shell";
import { Note } from "@/components/ui/alert";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { AlertIcon } from "@/components/ui/icons";
import { ButtonLink } from "@/components/ui/link";

export type InvitePreviewView = {
  workspace: { id: string; name: string; memberCount: number; publicRoomCount: number };
  inviter: { id: string; name: string };
};

/**
 * 招待リンクを開いたときの状態。
 * - valid: 参加できる（プレビュー → 参加）
 * - already_member: すでにメンバー。使用回数は消費しない（ADR 0011）
 * - invalid / expired / maxed: 使えない。ワークスペースの情報はサーバーが返さないので出さない
 */
export type InviteAcceptState =
  | { status: "valid"; preview: InvitePreviewView; accepting?: boolean }
  | { status: "already_member"; preview: InvitePreviewView }
  | { status: "invalid" | "expired" | "maxed" };

type InviteAcceptProps = {
  state: InviteAcceptState;
  onAccept?: () => void;
  onOpen?: () => void;
  homeHref: string;
};

export function InviteAccept({ state, onAccept, onOpen, homeHref }: InviteAcceptProps) {
  switch (state.status) {
    case "valid": {
      const { workspace, inviter } = state.preview;
      return (
        <div className="flex flex-col gap-5">
          <div className="flex flex-col items-center gap-3 text-center">
            <Avatar id={workspace.id} name={workspace.name} size="xl" shape="square" />
            <div className="flex flex-col gap-1">
              <h1 className="text-xl font-bold text-text">{workspace.name}</h1>
              <p className="text-sm text-text-muted">
                {workspace.memberCount}人のメンバー · {workspace.publicRoomCount} チャンネル
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2.5 rounded-md border border-border px-3.5 py-3">
            <Avatar id={inviter.id} name={inviter.name} size="sm" />
            <p className="text-sm text-text-secondary">
              <span className="font-semibold text-text">{inviter.name}</span> さんから招待されています
            </p>
          </div>
          <div className="flex flex-col items-center gap-3">
            <Button size="lg" onClick={onAccept} disabled={state.accepting}>
              参加する
            </Button>
            <p className="text-2xs text-text-muted">参加すると、公開チャンネルの履歴を読めるようになります。</p>
          </div>
        </div>
      );
    }
    case "already_member": {
      const { workspace } = state.preview;
      return (
        <StatusContent
          media={<Avatar id={workspace.id} name={workspace.name} size="xl" shape="square" />}
          title="すでに参加しています"
          description={
            <>
              あなたは <span className="font-semibold text-text">{workspace.name}</span>{" "}
              のメンバーです。招待を受け入れる必要はありません。
            </>
          }
        >
          <Button size="lg" onClick={onOpen}>
            開く
          </Button>
        </StatusContent>
      );
    }
    default:
      return <InviteUnavailable reason={state.status} homeHref={homeHref} />;
  }
}

const unavailableCopy = {
  invalid: {
    title: "この招待リンクは使えません",
    description: "リンクが取り消されたか、URL が間違っています。ワークスペースの情報は表示できません。",
  },
  expired: {
    title: "リンクの有効期限が切れています",
    description: "この招待リンクは期限を過ぎたため無効になりました。期限内であれば参加できました。",
  },
  maxed: {
    title: "このリンクは使用上限に達しました",
    description: "決められた回数ぶん使われたため、これ以上このリンクでは参加できません。",
  },
} as const;

function InviteUnavailable({ reason, homeHref }: { reason: keyof typeof unavailableCopy; homeHref: string }) {
  const copy = unavailableCopy[reason];
  return (
    <StatusContent tone="neutral" icon={<AlertIcon className="size-5" />} title={copy.title} description={copy.description}>
      <Note>招待した人に、新しいリンクの発行を頼んでください。</Note>
      <ButtonLink href={homeHref}>ホームに戻る</ButtonLink>
    </StatusContent>
  );
}
