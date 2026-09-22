"use client";

import {
  BellIcon,
  BellOffIcon,
  LinkIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  TrashIcon,
} from "@/components/ui/icons";
import { MenuItem } from "@/components/ui/menu-item";
import { Popover } from "@/components/ui/popover";

/**
 * メッセージの「…」のメニュー（ADR 0027 / 0040 / 0054 / 0056）。
 * 出せる操作がないときは MessageItem がメニュー自体を出さない（ADR 0018 の追記）。
 */
export function MessageMenu({
  copyLink,
  pin,
  pinnedBy,
  threadNotify,
  canEdit,
  canDelete,
  onEdit,
  onDelete,
  onToggleMenu,
}: {
  copyLink?: { label: string; onClick: () => void };
  pin?: { label: string; onClick: () => void };
  pinnedBy?: string;
  threadNotify?: { notifying: boolean; onClick: () => void };
  canEdit: boolean;
  canDelete: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
  onToggleMenu?: () => void;
}) {
  return (
    <Popover label="メッセージの操作" className="top-6 right-4 w-64" onDismiss={onToggleMenu}>
      {copyLink && (
        <MenuItem icon={LinkIcon} onClick={copyLink.onClick}>
          {copyLink.label}
        </MenuItem>
      )}
      {pin && (
        <MenuItem icon={pinnedBy ? PinOffIcon : PinIcon} onClick={pin.onClick}>
          {pin.label}
        </MenuItem>
      )}
      {threadNotify && (
        <MenuItem icon={threadNotify.notifying ? BellOffIcon : BellIcon} onClick={threadNotify.onClick}>
          {threadNotify.notifying ? "返信の通知をオフにする" : "新しい返信の通知を受け取る"}
        </MenuItem>
      )}
      {canEdit && (
        <MenuItem icon={PencilIcon} onClick={onEdit}>
          メッセージを編集
        </MenuItem>
      )}
      {canDelete && (
        <MenuItem icon={TrashIcon} onClick={onDelete} danger>
          メッセージを削除
        </MenuItem>
      )}
    </Popover>
  );
}
