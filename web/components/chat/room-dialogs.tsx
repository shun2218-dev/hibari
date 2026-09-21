import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, TextButton } from "@/components/ui/button";
import { RadioCard } from "@/components/ui/choice";
import { Dialog } from "@/components/ui/dialog";
import { TextField } from "@/components/ui/field";
import { FileIcon, SearchIcon } from "@/components/ui/icons";

import type { PresenceView } from "@/lib/presence";

import type { RoomKind, UserRef } from "./types";

/** 作成できるのは public / private だけ（DM は相手を選んで作る）。 */
export type CreatableRoomKind = Exclude<RoomKind, "dm">;

export function CreateRoomDialog({
  open,
  name,
  kind,
  onNameChange,
  onKindChange,
  creating,
  onCancel,
  onCreate,
}: {
  open: boolean;
  name: string;
  kind: CreatableRoomKind;
  onNameChange?: (name: string) => void;
  onKindChange?: (kind: CreatableRoomKind) => void;
  creating?: boolean;
  onCancel?: () => void;
  onCreate?: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      width="wide"
      title="チャンネルを作成"
      // kind を変える API がないので、公開範囲は作成時にしか決められない
      description="あとから名前は変更できます。公開範囲は作成後に変えられません。"
      actions={
        <>
          <Button variant="secondary" onClick={onCancel}>
            キャンセル
          </Button>
          <Button onClick={onCreate} disabled={creating || name.trim() === ""}>
            作成する
          </Button>
        </>
      }
    >
      <TextField
        label="チャンネル名"
        value={name}
        onChange={(e) => onNameChange?.(e.target.value)}
        hint="ワークスペースの中で名前は重複できません。"
      />
      <fieldset className="flex flex-col gap-2">
        <legend className="pb-2 text-xs font-medium text-text">公開範囲</legend>
        <RadioCard
          name="room-kind"
          value="public"
          checked={kind === "public"}
          onChange={() => onKindChange?.("public")}
          title="公開"
          description="ワークスペースの全員が読めます。投稿するには参加が必要です"
        />
        <RadioCard
          name="room-kind"
          value="private"
          checked={kind === "private"}
          onChange={() => onKindChange?.("private")}
          title="非公開"
          description="追加したメンバーだけが読めます。あとから追加できます"
        />
      </fieldset>
    </Dialog>
  );
}

export type DmCandidateView = UserRef & { handle: string; presence: PresenceView };

/**
 * DM の相手を選ぶ。相手はワークスペースのメンバーだけで、ひとりだけ選べる
 * （グループ DM はスコープ外、メンバーの追加もできない）。すでにある DM なら、それを開く。
 */
export function StartDmDialog({
  open,
  candidates,
  selectedId,
  search = "",
  onSearchChange,
  onSelect,
  onCancel,
  onOpen,
  opening,
}: {
  open: boolean;
  candidates: DmCandidateView[];
  selectedId?: string;
  search?: string;
  onSearchChange?: (value: string) => void;
  onSelect?: (userId: string) => void;
  onCancel?: () => void;
  onOpen?: () => void;
  opening?: boolean;
}) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      width="wide"
      title="ダイレクトメッセージ"
      description="相手を選んでください。同じ相手とのダイレクトメッセージは 1 つにまとまります。"
      actions={
        <>
          <Button variant="secondary" onClick={onCancel}>
            キャンセル
          </Button>
          <Button onClick={onOpen} disabled={opening || !selectedId}>
            開く
          </Button>
        </>
      }
    >
      <MemberPicker
        name="dm-peer"
        candidates={candidates}
        selectedId={selectedId}
        search={search}
        onSearchChange={onSearchChange}
        onSelect={onSelect}
        emptyText="ほかにメンバーがいません。招待リンクで誰かを招待してください。"
      />
    </Dialog>
  );
}

/**
 * 非公開チャンネルに追加する相手を選ぶ（`RoomSettingsDialog` の「メンバーを追加」から開く）。
 * 候補はワークスペースのメンバーのうち、まだこのチャンネルにいない人だけ。ひとりずつ追加する。
 */
export function AddRoomMemberDialog({
  open,
  candidates,
  selectedId,
  search = "",
  onSearchChange,
  onSelect,
  onCancel,
  onAdd,
  adding,
}: {
  open: boolean;
  candidates: DmCandidateView[];
  selectedId?: string;
  search?: string;
  onSearchChange?: (value: string) => void;
  onSelect?: (userId: string) => void;
  onCancel?: () => void;
  onAdd?: () => void;
  adding?: boolean;
}) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      width="wide"
      title="メンバーを追加"
      description="このチャンネルに追加する人を選んでください。参加前の履歴も読めるようになります。"
      actions={
        <>
          <Button variant="secondary" onClick={onCancel}>
            キャンセル
          </Button>
          <Button onClick={onAdd} disabled={adding || !selectedId}>
            追加する
          </Button>
        </>
      }
    >
      <MemberPicker
        name="add-member"
        candidates={candidates}
        selectedId={selectedId}
        search={search}
        onSearchChange={onSearchChange}
        onSelect={onSelect}
        emptyText="追加できる人がいません。ワークスペースの全員がこのチャンネルにいます。"
      />
    </Dialog>
  );
}

/** 相手をひとり選ぶ（DM とメンバーの追加で同じ形にする）。 */
function MemberPicker({
  name,
  candidates,
  selectedId,
  search,
  onSearchChange,
  onSelect,
  emptyText,
}: {
  name: string;
  candidates: DmCandidateView[];
  selectedId?: string;
  search: string;
  onSearchChange?: (value: string) => void;
  onSelect?: (userId: string) => void;
  emptyText: string;
}) {
  return (
    <>
      <label className="flex h-8.5 items-center gap-2 rounded-sm border border-border px-2.5 has-focus-visible:outline-2 has-focus-visible:-outline-offset-2 has-focus-visible:outline-primary">
        <SearchIcon className="size-4 shrink-0 text-text-secondary" />
        <input
          type="search"
          aria-label="メンバーを検索"
          placeholder="メンバーを検索"
          value={search}
          onChange={(e) => onSearchChange?.(e.target.value)}
          className="min-w-0 flex-1 bg-transparent text-sm text-text focus-visible:outline-none"
        />
      </label>
      {candidates.length === 0 ? (
        <p className="py-6 text-center text-sm text-text-muted">{emptyText}</p>
      ) : (
        <fieldset className="-mx-1 flex max-h-66 flex-col gap-2 overflow-y-auto px-1">
          <legend className="sr-only">相手</legend>
          {candidates.map((candidate) => (
            <RadioCard
              key={candidate.id}
              name={name}
              value={candidate.id}
              checked={candidate.id === selectedId}
              onChange={onSelect}
              leading={
                <Avatar
                  id={candidate.id}
                  name={candidate.name}
                  imageUrl={candidate.avatarUrl}
                  size="sm"
                  presence={candidate.presence}
                />
              }
              title={candidate.name}
              description={<span className="font-mono">@{candidate.handle}</span>}
            />
          ))}
        </fieldset>
      )}
    </>
  );
}

export type RoomMemberRowView = UserRef & { isSelf: boolean; canRemove: boolean };

/**
 * ルームの名前とメンバーを変える。変更できるのは、そのルームを読める admin 以上（ADR 0011）。
 * public は参加が自由なのでメンバーの一覧は出さない。DM は設定を変えられないので、この画面自体を開かない。
 *
 * 退出はロールに関係なく参加している人なら誰でもできるので、`onLeave` を渡したときだけ下に出す
 * （参加していない public を開いたときは渡さない）。形はワークスペースの退出（`workspace/settings/settings-as-member.png`）に合わせる。
 */
export function RoomSettingsDialog({
  open,
  kind,
  name,
  members,
  canEdit,
  onNameChange,
  onAddMember,
  onRemoveMember,
  onLeave,
  onCancel,
  onSave,
  saving,
}: {
  open: boolean;
  kind: CreatableRoomKind;
  name: string;
  members: RoomMemberRowView[];
  canEdit: boolean;
  onNameChange?: (name: string) => void;
  onAddMember?: () => void;
  onRemoveMember?: (userId: string) => void;
  onLeave?: () => void;
  onCancel?: () => void;
  onSave?: () => void;
  saving?: boolean;
}) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      width="wide"
      title="チャンネルの設定"
      description={
        canEdit
          ? "変更できるのは、このチャンネルを読める管理者とオーナーだけです。"
          : "チャンネルの設定を変更できるのは管理者とオーナーだけです。"
      }
      actions={
        <>
          <Button variant="secondary" onClick={onCancel}>
            {canEdit ? "キャンセル" : "閉じる"}
          </Button>
          {canEdit && (
            <Button onClick={onSave} disabled={saving || name.trim() === ""}>
              保存する
            </Button>
          )}
        </>
      }
    >
      <TextField label="チャンネル名" value={name} onChange={(e) => onNameChange?.(e.target.value)} disabled={!canEdit} />

      {kind === "private" && (
        <div className="flex flex-col gap-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs font-medium text-text">参加しているメンバー</span>
            {canEdit && (
              <button
                type="button"
                onClick={onAddMember}
                className="h-8 rounded-sm border border-border px-3 text-sm font-medium text-primary hover:bg-surface-muted"
              >
                メンバーを追加
              </button>
            )}
          </div>
          <ul className="rounded-md border border-border">
            {members.map((member, index) => (
              <li
                key={member.id}
                className={`flex items-center gap-2.5 px-3.5 py-2.5 ${index > 0 ? "border-t border-border" : ""}`}
              >
                <Avatar id={member.id} name={member.name} imageUrl={member.avatarUrl} size="sm" />
                <span className="min-w-0 flex-1 truncate text-base font-semibold text-text">{member.name}</span>
                {member.isSelf ? (
                  <Badge tone="primary">あなた</Badge>
                ) : (
                  canEdit &&
                  member.canRemove && (
                    <TextButton tone="danger" onClick={() => onRemoveMember?.(member.id)} className="text-sm font-semibold">
                      外す
                    </TextButton>
                  )
                )}
              </li>
            ))}
          </ul>
          <p className="text-2xs text-text-muted">非公開チャンネルのメンバーだけが読めます。参加前の履歴も読めます。</p>
        </div>
      )}

      {onLeave && (
        <section className="flex flex-col gap-1 border-t border-border pt-4">
          <h3 className="text-sm font-bold text-text">チャンネルを退出</h3>
          <p className="pb-3 text-sm text-text-secondary">{leaveConsequence(kind)}</p>
          <Button variant="danger-outline" onClick={onLeave} className="self-start">
            退出する
          </Button>
        </section>
      )}
    </Dialog>
  );
}

/** 退出したあとに読めるかどうかは公開範囲で変わる（ADR 0011）。設定の画面と確認で同じ文言にする。 */
function leaveConsequence(kind: CreatableRoomKind): string {
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

/** 削除するメッセージを引用して、どれを消すのか取り違えないようにする。 */
export function DeleteMessageDialog({
  open,
  body,
  onCancel,
  onConfirm,
  pending,
}: {
  open: boolean;
  body: string;
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
        {body}
      </blockquote>
    </Dialog>
  );
}
