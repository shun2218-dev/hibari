import { Avatar } from "@/components/ui/avatar";
import { IconButton } from "@/components/ui/button";
import { CloseIcon } from "@/components/ui/icons";

import type { RoomMemberView } from "./types";

/**
 * ルームのメンバー。md 以上では右のパネル、モバイルでは下から出るシートにする。
 * 同じ要素をレイアウトだけ切り替えて使い、DOM に 2 回描かない。
 */
export function MembersPanel({ members, onClose }: { members: RoomMemberView[]; onClose?: () => void }) {
  return (
    <>
      <div aria-hidden className="fixed inset-0 z-30 bg-overlay md:hidden" onClick={onClose} />
      <aside
        aria-label="メンバー"
        className="fixed inset-x-0 bottom-0 z-40 flex max-h-3/4 flex-col rounded-t-lg bg-surface md:static md:z-auto md:max-h-none md:w-70 md:shrink-0 md:rounded-none md:border-l md:border-border"
      >
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border pr-2 pl-4">
          <h2 className="text-sm font-bold text-text">メンバー</h2>
          <IconButton label="閉じる" onClick={onClose}>
            <CloseIcon className="size-4" />
          </IconButton>
        </header>
        <ul className="min-h-0 overflow-y-auto py-2">
          {members.map((member) => (
            <li key={member.id} className="flex items-center gap-2.5 px-4 py-2">
              <Avatar id={member.id} name={member.name} size="sm" online={member.online} />
              <div className="min-w-0">
                <p className="truncate text-base font-semibold text-text">{member.name}</p>
                <p className="text-2xs text-text-muted">{member.roleLabel}</p>
              </div>
            </li>
          ))}
        </ul>
      </aside>
    </>
  );
}
