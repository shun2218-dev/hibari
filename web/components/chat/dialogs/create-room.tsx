import type { RoomKind } from "@/components/chat/types";
import { Button } from "@/components/ui/button";
import { RadioCard } from "@/components/ui/choice";
import { Dialog } from "@/components/ui/dialog";
import { TextField } from "@/components/ui/field";

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
