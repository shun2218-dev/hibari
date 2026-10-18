import { Alert } from "@/components/ui/alert";
import { Avatar } from "@/components/ui/avatar";
import { TextButton } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";

/**
 * アバター画像の状態（ADR 0020）。
 * - idle: 何もしていない
 * - uploading: 選んだ画像をアップロードしている
 * - failed: アップロードに失敗した（再試行できる）
 */
export type AvatarUploadState = "idle" | "uploading" | "failed";

export function ProfileSettings({
  user,
  avatarState = "idle",
  onChangeImage,
  onRemoveImage,
  onRetryImage,
  onDisplayNameChange,
  onHandleChange,
  onDisplayNameCommit,
  onHandleCommit,
}: {
  user: { id: string; displayName: string; handle: string; avatarUrl?: string };
  avatarState?: AvatarUploadState;
  onChangeImage?: () => void;
  onRemoveImage?: () => void;
  onRetryImage?: () => void;
  onDisplayNameChange?: (value: string) => void;
  onHandleChange?: (value: string) => void;
  /** 変更を確定する（フォーカスを外したとき）。WorkspaceSettings の名前と同じ形。 */
  onDisplayNameCommit?: () => void;
  onHandleCommit?: () => void;
}) {
  const uploading = avatarState === "uploading";
  return (
    <div className="flex max-w-100 flex-col gap-5">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3.5">
          <span className="relative inline-flex">
            <Avatar
              id={user.id}
              name={user.displayName}
              imageUrl={user.avatarUrl}
              size="xl"
              className={uploading ? "opacity-40" : undefined}
            />
            {uploading && (
              <span className="absolute inset-0 flex items-center justify-center">
                <Spinner className="size-5 text-attention" />
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={onChangeImage}
            disabled={uploading}
            className="h-8.5 rounded-sm border border-border px-3 text-sm font-medium text-primary hover:bg-surface-muted disabled:border-border disabled:bg-surface-muted disabled:text-text-muted"
          >
            画像を変更
          </button>
          {uploading ? (
            <span className="text-xs text-attention-text">アップロード中…</span>
          ) : (
            user.avatarUrl && (
              <TextButton tone="danger" onClick={onRemoveImage} className="text-sm font-semibold">
                削除
              </TextButton>
            )
          )}
        </div>
        {avatarState === "failed" && (
          <Alert tone="danger">
            画像をアップロードできませんでした
            <button type="button" onClick={onRetryImage} className="ml-2 font-semibold text-primary hover:underline">
              再試行
            </button>
          </Alert>
        )}
        <p className="text-2xs text-text-muted">PNG / JPEG / WebP、2 MB まで。正方形に切り取って表示します。</p>
      </div>
      <TextField
        label="表示名"
        value={user.displayName}
        onChange={(e) => onDisplayNameChange?.(e.target.value)}
        onBlur={onDisplayNameCommit}
      />
      <TextField
        label="ハンドル"
        mono
        value={`@${user.handle}`}
        onChange={(e) => onHandleChange?.(e.target.value.replace(/^@/, ""))}
        onBlur={onHandleCommit}
      />
    </div>
  );
}
