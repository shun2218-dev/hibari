import type { UserRef } from "@/components/chat/types";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, TextButton } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { TextField } from "@/components/ui/field";

import { ARCHIVE_CONSEQUENCE } from "./archive-room";
import type { CreatableRoomKind } from "./create-room";
import { DELETE_CONSEQUENCE } from "./delete-room";
import { leaveConsequence } from "./leave-room";

export type RoomMemberRowView = UserRef & { isSelf: boolean; canRemove: boolean };

/**
 * ルームの名前とメンバーを変える。変更できるのは、そのルームを読める admin 以上（ADR 0011）。
 * public は参加が自由なのでメンバーの一覧は出さない。DM は設定を変えられないので、この画面自体を開かない。
 *
 * 退出はロールに関係なく参加している人なら誰でもできるので、`onLeave` を渡したときだけ下に出す
 * （参加していない public を開いたときは渡さない）。形はワークスペースの退出（`workspace/settings/settings-as-member.png`）に合わせる。
 *
 * アーカイブ・復元・削除（ADR 0059）も、できる人だけに渡す。アーカイブと復元はルームのメンバー、削除は admin 以上。
 * アーカイブ中は設定を変えられないので、名前は読み取り専用にし、メンバーの追加と外すを出さない。
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
  archived = false,
  onArchive,
  onUnarchive,
  onDelete,
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
  /** アーカイブされている（ADR 0059）。 */
  archived?: boolean;
  /** アーカイブの確認を開く。アーカイブできる人（ルームのメンバー、admin 以上）で、アーカイブされていないときだけ渡す。 */
  onArchive?: () => void;
  /** 復元する。アーカイブできる人で、アーカイブされているときだけ渡す。戻せる操作なので確認は挟まない。 */
  onUnarchive?: () => void;
  /** 削除の確認を開く。admin 以上にだけ渡す。 */
  onDelete?: () => void;
  onCancel?: () => void;
  onSave?: () => void;
  saving?: boolean;
}) {
  const editable = canEdit && !archived;
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      width="wide"
      title="チャンネルの設定"
      description={
        archived
          ? "アーカイブされているあいだは、設定を変更できません。"
          : canEdit
            ? "変更できるのは、このチャンネルを読める管理者とオーナーだけです。"
            : "チャンネルの設定を変更できるのは管理者とオーナーだけです。"
      }
      actions={
        <>
          <Button variant="secondary" onClick={onCancel}>
            {editable ? "キャンセル" : "閉じる"}
          </Button>
          {editable && (
            <Button onClick={onSave} disabled={saving || name.trim() === ""}>
              保存する
            </Button>
          )}
        </>
      }
    >
      {/*
        節が増えると（アーカイブ・削除。ADR 0059）画面の高さに収まらないので、中身だけをスクロールさせる。
        見出しと操作のボタンは残す。-mx / px は、フォーカスの輪がスクロールの枠で切れないようにするため。
      */}
      <div className="-mx-1 flex min-h-0 flex-col gap-5 overflow-y-auto px-1">
        <TextField label="チャンネル名" value={name} onChange={(e) => onNameChange?.(e.target.value)} disabled={!editable} />

        {kind === "private" && (
          <div className="flex flex-col gap-2.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-medium text-text">参加しているメンバー</span>
              {editable && (
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
                    editable &&
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

        {onArchive && (
          <section className="flex flex-col gap-1 border-t border-border pt-4">
            <h3 className="text-sm font-bold text-text">チャンネルをアーカイブ</h3>
            <p className="pb-3 text-sm text-text-secondary">{ARCHIVE_CONSEQUENCE}</p>
            <Button variant="secondary" onClick={onArchive} className="self-start">
              アーカイブする
            </Button>
          </section>
        )}

        {onUnarchive && (
          <section className="flex flex-col gap-1 border-t border-border pt-4">
            <h3 className="text-sm font-bold text-text">チャンネルを復元</h3>
            <p className="pb-3 text-sm text-text-secondary">復元すると、メンバーはそのままで、また投稿できるようになります。</p>
            <Button variant="primary-outline" onClick={onUnarchive} className="self-start">
              復元する
            </Button>
          </section>
        )}

        {onDelete && (
          <section className="flex flex-col gap-1 border-t border-border pt-4">
            <h3 className="text-sm font-bold text-text">チャンネルを削除</h3>
            <p className="pb-3 text-sm text-text-secondary">{DELETE_CONSEQUENCE}</p>
            <Button variant="danger-outline" onClick={onDelete} className="self-start">
              削除する
            </Button>
          </section>
        )}
      </div>
    </Dialog>
  );
}
