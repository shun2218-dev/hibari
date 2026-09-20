"use client";

import { useRef, useState } from "react";

import { type AvatarUploadState, ProfileSettings } from "@/components/settings/settings-sections";
import { useSession, useSessionState } from "@/lib/auth/session-provider";
import { putFileWithXhr } from "@/lib/chat/put-file";

/** 受け付ける画像（ADR 0020。上限の 2 MiB はサーバーの設定値なので、ここでは見ない）。 */
const ACCEPTED_TYPES = "image/png,image/jpeg,image/webp";

/**
 * プロフィール（表示名・ハンドル・アバター画像）。
 *
 * 表示名とハンドルは入力中だけ手元の値を使い、フォーカスを外したらサーバーに送る。
 * 画像は署名付き URL でストレージに直接 PUT する（中身はサーバーを経由しない。CLAUDE.md ルール 10）。
 */
export function ProfileSection() {
  const session = useSession();
  const { state } = useSessionState();
  const user = state.status === "signed_in" ? state.user : undefined;

  const [draft, setDraft] = useState<{ displayName?: string; handle?: string }>({});
  const [avatarState, setAvatarState] = useState<AvatarUploadState>("idle");
  const fileInput = useRef<HTMLInputElement>(null);
  // 失敗したときに、同じ画像でもう一度試すために持っておく
  const lastFile = useRef<File>(null);

  if (!user) return null;

  async function commit(patch: { display_name?: string; handle?: string }) {
    try {
      await session.updateProfile(patch);
    } catch (err) {
      // handle の重複（409）や入力のエラー（422）の表示はデザインにない（docs/ui/README.md の未解決）。サーバーの値に戻す
      console.error("failed to update the profile", err);
    } finally {
      setDraft({});
    }
  }

  function commitDisplayName() {
    const next = draft.displayName?.trim();
    if (next === undefined || next === "" || next === user!.display_name) {
      setDraft((d) => ({ ...d, displayName: undefined }));
      return;
    }
    void commit({ display_name: next });
  }

  function commitHandle() {
    const next = draft.handle?.trim();
    if (next === undefined || next === "" || next === user!.handle) {
      setDraft((d) => ({ ...d, handle: undefined }));
      return;
    }
    void commit({ handle: next });
  }

  async function upload(file: File) {
    lastFile.current = file;
    setAvatarState("uploading");
    try {
      // サーバーが許す種類（ADR 0020）以外は、申告せずにそのまま送って 422 を受ける方が、手元の一覧と二重にならない
      const { upload_id, upload } = await session.createAvatarUpload({
        content_type: file.type,
        size_bytes: file.size,
      });
      await putFileWithXhr(upload.url, upload.headers, file, {
        onProgress: () => {}, // 進み具合のデザインはアップロード中の表示だけ（settings/profile/profile-avatar-uploading.png）
        signal: new AbortController().signal,
      });
      await session.completeAvatarUpload({ upload_id, content_type: file.type, size_bytes: file.size });
      setAvatarState("idle");
    } catch (err) {
      // 理由（大きすぎる、種類が許されていない）の表示はデザインにない。「アップロードできませんでした」と再試行だけ出す
      console.error("failed to upload the avatar", err);
      setAvatarState("failed");
    }
  }

  async function removeImage() {
    try {
      await session.deleteAvatar();
      setAvatarState("idle");
    } catch (err) {
      console.error("failed to remove the avatar", err);
    }
  }

  return (
    <>
      <ProfileSettings
        user={{
          id: user.id,
          displayName: draft.displayName ?? user.display_name,
          handle: draft.handle ?? user.handle,
          avatarUrl: user.avatar_url,
        }}
        avatarState={avatarState}
        onChangeImage={() => fileInput.current?.click()}
        onRemoveImage={removeImage}
        onRetryImage={() => lastFile.current && void upload(lastFile.current)}
        onDisplayNameChange={(value) => setDraft((d) => ({ ...d, displayName: value }))}
        onHandleChange={(value) => setDraft((d) => ({ ...d, handle: value }))}
        onDisplayNameCommit={commitDisplayName}
        onHandleCommit={commitHandle}
      />
      <input
        ref={fileInput}
        type="file"
        accept={ACCEPTED_TYPES}
        data-testid="avatar-file"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          // 同じファイルをもう一度選べるように、値を空に戻す
          e.target.value = "";
          if (file) void upload(file);
        }}
      />
    </>
  );
}
