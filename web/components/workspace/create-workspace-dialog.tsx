import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { TextField } from "@/components/ui/field";

/** ワークスペース名の上限（rune 単位）。サーバーの workspaceNameMax と同じ。 */
const WORKSPACE_NAME_MAX = 50;

/** ワークスペースを作成する（chat/workspace-create-dialog.png）。入力は名前だけ（ADR 0011）。 */
export function CreateWorkspaceDialog({
  open,
  name = "",
  onNameChange,
  creating,
  onCancel,
  onCreate,
}: {
  open: boolean;
  name?: string;
  onNameChange?: (name: string) => void;
  creating?: boolean;
  onCancel?: () => void;
  onCreate?: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title="ワークスペースを作成"
      description="あとから名前は変更できます"
      actions={
        <>
          <Button variant="secondary" onClick={onCancel}>
            キャンセル
          </Button>
          <Button onClick={onCreate} disabled={creating || name.trim() === ""}>
            作成
          </Button>
        </>
      }
    >
      <TextField
        label="ワークスペース名"
        placeholder="例: hibari 開発"
        value={name}
        maxLength={WORKSPACE_NAME_MAX}
        onChange={(e) => onNameChange?.(e.target.value)}
      />
    </Dialog>
  );
}
