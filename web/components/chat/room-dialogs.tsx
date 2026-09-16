import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, TextButton } from "@/components/ui/button";
import { RadioCard } from "@/components/ui/choice";
import { Dialog } from "@/components/ui/dialog";
import { TextField } from "@/components/ui/field";
import { SearchIcon } from "@/components/ui/icons";

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

export type DmCandidateView = UserRef & { handle: string; online: boolean };

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
      <fieldset className="-mx-1 flex max-h-66 flex-col gap-2 overflow-y-auto px-1">
        <legend className="sr-only">相手</legend>
        {candidates.map((candidate) => (
          <RadioCard
            key={candidate.id}
            name="dm-peer"
            value={candidate.id}
            checked={candidate.id === selectedId}
            onChange={onSelect}
            leading={<Avatar id={candidate.id} name={candidate.name} imageUrl={candidate.avatarUrl} size="sm" online={candidate.online} />}
            title={candidate.name}
            description={<span className="font-mono">@{candidate.handle}</span>}
          />
        ))}
      </fieldset>
    </Dialog>
  );
}

export type RoomMemberRowView = UserRef & { isSelf: boolean; canRemove: boolean };

/**
 * ルームの名前とメンバーを変える。変更できるのは、そのルームを読める admin 以上（ADR 0011）。
 * public は参加が自由なのでメンバーの一覧は出さない。DM は設定を変えられないので、この画面自体を開かない。
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
