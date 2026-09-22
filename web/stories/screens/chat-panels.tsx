"use client";

import type { ComponentProps } from "react";

import { RoomSettingsDialog } from "@/components/chat/dialogs/room-settings";
import { ImageViewer } from "@/components/chat/image-viewer";
import { ProfilePanel } from "@/components/chat/profile-panel";
import { roomSettingsMembers } from "@/stories/fixtures/rooms";
import {
  deletedThreadReplies,
  deletedThreadRoot,
  threadReplies,
  threadRepliesWithBroadcast,
  threadRoot,
  threadRootWithoutReplies,
} from "@/stories/fixtures/threads";
import { profileKeys, profiles, users } from "@/stories/fixtures/users";

import type { ChatOptions } from "./chat";
import { noop } from "./shared";

/**
 * チャットの画面に重ねるもの（プロフィール・スレッド・画像の拡大・ルームの設定）。
 */
/** ホバーのカードを出すメッセージと、その中身。 */
export function profileHover(profile: NonNullable<ChatOptions["profile"]>) {
  switch (profile) {
    case "hover-self":
      return { key: profileKeys.you, profile: profiles.you };
    case "hover-former":
      return { key: profileKeys.former, profile: profiles.former };
    default:
      return { key: profileKeys.naoki, profile: profiles.naoki };
  }
}

/** 右のパネル（モバイルは全画面）。 */
export function profilePanelContent(profile: NonNullable<ChatOptions["profile"]>) {
  switch (profile) {
    case "panel-menu":
      return <ProfilePanel profile={profiles.naoki} menuOpen />;
    case "panel-manage":
      return <ProfilePanel profile={profiles.ryo} menuOpen />;
    case "panel-self":
      return <ProfilePanel profile={profiles.you} />;
    case "panel-loading":
      return <ProfilePanel profile={profiles.miyukiLoading} />;
    case "panel-unverified":
      return <ProfilePanel profile={profiles.miyukiUnverified} />;
    case "panel-former":
      return <ProfilePanel profile={profiles.former} />;
    case "panel-unknown":
      return <ProfilePanel profile={{ kind: "unknown" }} />;
    case "panel-from-members":
      return <ProfilePanel profile={profiles.naoki} onBack={noop} />;
    default:
      return <ProfilePanel profile={profiles.naoki} />;
  }
}

/** スレッドのパネルに出す親と返信。 */
export function threadPanelContent(thread: NonNullable<ChatOptions["thread"]>) {
  switch (thread) {
    case "replies":
      return { root: threadRoot, replies: threadReplies, typing: [users.naoki.name] };
    case "empty":
      return { root: threadRootWithoutReplies, replies: [], typing: [] };
    case "root-deleted":
      return { root: deletedThreadRoot, replies: deletedThreadReplies, typing: [] };
    case "broadcast":
      return { root: threadRoot, replies: threadRepliesWithBroadcast, typing: [] };
  }
}

/**
 * 拡大表示（ADR 0045）。閉じる・送る・ダウンロードはどの画面でも同じなので、ここでまとめる。
 * 消せない人の画面だけ削除を出さない（決定 9）。
 */
export function imageViewer(images: ComponentProps<typeof ImageViewer>["images"], index: number, canDelete = true) {
  return (
    <ImageViewer
      images={images}
      index={index}
      onMove={noop}
      onClose={noop}
      onDownload={noop}
      onDelete={canDelete ? noop : undefined}
    />
  );
}

/** チャンネルの設定のダイアログ。読み取り専用（member）のときだけ退出を出す。 */
export function roomSettingsDialog({
  canEdit,
  onLeave,
  archive,
}: {
  canEdit: boolean;
  onLeave?: () => void;
  /**
   * アーカイブ・復元・削除の節（ADR 0059）。
   * - member: アーカイブだけ（ルームのメンバーの member）
   * - admin: アーカイブと削除
   * - archived: アーカイブ中に admin が開いたところ（復元と削除）
   */
  archive?: "member" | "admin" | "archived";
}) {
  return (
    <RoomSettingsDialog
      open
      kind="private"
      name="リリース準備"
      canEdit={canEdit}
      members={roomSettingsMembers}
      onLeave={onLeave}
      archived={archive === "archived"}
      onArchive={archive === "member" || archive === "admin" ? noop : undefined}
      onUnarchive={archive === "archived" ? noop : undefined}
      onDelete={archive === "admin" || archive === "archived" ? noop : undefined}
    />
  );
}
