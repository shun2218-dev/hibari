"use client";

import { users } from "@/stories/fixtures/users";
import { workspaces } from "@/stories/fixtures/workspaces";

/**
 * 招待リンクを開いた画面（ADR 0030）。
 */
export const invitePreview = {
  workspace: { id: workspaces.yama.id, name: workspaces.yama.name, memberCount: 6, publicRoomCount: 8 },
  inviter: { id: users.misaki.id, name: users.misaki.name },
};

export const inviteFooter = (
  <>
    別のアカウントで開きますか？{" "}
    <button type="button" className="font-medium text-primary hover:underline">
      ログアウト
    </button>
  </>
);
