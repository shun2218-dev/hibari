import type { AvatarUpload, AvatarUploadRequest, CompleteAvatarUploadRequest, UpdateProfileRequest, User } from "@/lib/api/types.gen";

import type { SessionCore } from "./core";

/**
 * プロフィール（表示名・ハンドル）とアバター（ADR 0019 / 0020 / 0031）。
 */
export function createProfile(core: SessionCore) {
  const { request, setState } = core;

  return {
    /**
     * 表示名とハンドルを変える。応答の user で画面の状態も進める。
     * 失敗したら ApiError（409 handle-taken、422 validation-error）を投げる。
     */
    async updateProfile(input: UpdateProfileRequest): Promise<void> {
      const user = await request<User>("PATCH", "/api/v1/users/me", input);
      setState({ status: "signed_in", user });
    },

    /** アバター画像の署名付き PUT URL を発行する（中身はサーバーを経由しない。ADR 0020）。 */
    createAvatarUpload(input: AvatarUploadRequest): Promise<AvatarUpload> {
      return request<AvatarUpload>("POST", "/api/v1/users/me/avatar", input);
    },

    /** PUT したオブジェクトを HEAD で検証し、プロフィールに反映する。 */
    async completeAvatarUpload(input: CompleteAvatarUploadRequest): Promise<void> {
      const user = await request<User>("POST", "/api/v1/users/me/avatar/complete", input);
      setState({ status: "signed_in", user });
    },

    /** 画像を外す（頭文字の表示に戻る）。 */
    async deleteAvatar(): Promise<void> {
      const user = await request<User>("DELETE", "/api/v1/users/me/avatar");
      setState({ status: "signed_in", user });
    },
  };
}

export type Profile = ReturnType<typeof createProfile>;
