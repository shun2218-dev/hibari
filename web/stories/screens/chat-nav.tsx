"use client";

import type { ComponentProps, ReactNode } from "react";

import { AccountMenu } from "@/components/chat/account-menu";
import { ActivityList } from "@/components/chat/activity-list";
import { DmList } from "@/components/chat/dm-list";
import { RoomHeader } from "@/components/chat/room-header";
import { SavedList } from "@/components/chat/saved-list";
import { type SideNavItems, type SideNavKey, SideNavRail } from "@/components/chat/side-nav";
import { Sidebar } from "@/components/chat/sidebar";
import type { ActivityFilter } from "@/components/chat/types";
import { WorkspaceSwitcher } from "@/components/chat/workspace-switcher";
import { Avatar } from "@/components/ui/avatar";
import { activityItems } from "@/stories/fixtures/activity";
import { dmRooms, rooms, selectedRoom, sideNavBadges } from "@/stories/fixtures/rooms";
import { savedArchived, savedInProgress } from "@/stories/fixtures/saved";
import { currentUser, myStatus, users } from "@/stories/fixtures/users";
import { workspaces } from "@/stories/fixtures/workspaces";

import type { ChatOptions } from "./chat";
import { noHref, noop, roomHref } from "./shared";

/**
 * 左のレールとメニュー、ルームのヘッダーだけを切り出した枠（ADR 0058）。
 */
/** 左のメニューの行き先とバッジ（ADR 0058 決定 1）。 */
export const sideNavItems: SideNavItems = {
  home: { href: noHref },
  dms: { href: noHref, badge: sideNavBadges.dms },
  activity: { href: noHref, badge: sideNavBadges.activity },
  later: { href: noHref },
};

/** md 以上の左のメニュー。ワークスペースの切り替えとアカウントのメニューは、ここから開く。 */
export function sideRail(
  side: SideNavKey,
  {
    switcher,
    accountMenu,
    presence,
    preview,
  }: { switcher?: boolean; accountMenu?: boolean; presence?: boolean; preview?: ChatOptions["preview"] },
) {
  return (
    <SideNavRail
      items={sideNavItems}
      current={side}
      openPreview={preview}
      previews={{
        dms: <DmList variant="preview" rooms={dmRooms} roomHref={roomHref} />,
        activity: <ActivityList variant="preview" filter="all" unreadOnly={false} items={activityItems} />,
        later: <SavedList variant="preview" tab="in_progress" inProgressCount={savedInProgress.length} items={savedInProgress} />,
      }}
      workspace={
        <>
          <button type="button" aria-label="ワークスペースを切り替える" aria-expanded={Boolean(switcher)} aria-haspopup="dialog" className="rounded-sm">
            <Avatar id={workspaces.dev.id} name={workspaces.dev.name} size="md" shape="square" />
          </button>
          {switcher && (
            <WorkspaceSwitcher placement="rail" workspaces={[workspaces.dev, workspaces.memo]} currentWorkspaceId={workspaces.dev.id} />
          )}
        </>
      }
      account={
        <>
          <button type="button" aria-label="アカウントメニュー" aria-expanded={Boolean(accountMenu)} aria-haspopup="dialog" className="rounded-full">
            <Avatar id={currentUser.id} name={currentUser.name} imageUrl={currentUser.avatarUrl} size="sm" />
          </button>
          {accountMenu && (
            <AccountMenu placement="rail" user={{ ...users.you, handle: users.you.handle, status: presence ? myStatus : undefined }} away={presence} />
          )}
        </>
      }
    />
  );
}

/** サイドバーの列の中身。左のメニューで選んだものを出す（ADR 0058 決定 1）。 */
export function sidePane(
  side: SideNavKey,
  home: ReactNode,
  {
    activity,
    dmsEmpty,
    dmsUnread,
    saved,
    savedTab,
    savedItems,
  }: {
    activity?: ChatOptions["activity"];
    dmsEmpty?: boolean;
    dmsUnread?: boolean;
    saved?: ChatOptions["saved"];
    savedTab: ComponentProps<typeof SavedList>["tab"];
    savedItems: NonNullable<ComponentProps<typeof SavedList>["items"]>;
  },
) {
  switch (side) {
    case "home":
      return home;
    case "dms":
      return (
        <DmList
          rooms={dmsEmpty ? [] : dmsUnread ? dmRooms.filter((room) => room.unreadCount > 0) : dmRooms}
          unreadOnly={dmsUnread}
          roomHref={roomHref}
          onStartDm={noop}
        />
      );
    case "activity": {
      const filter: ActivityFilter =
        activity === "dm" || activity === "mention" || activity === "thread" || activity === "reaction" ? activity : "all";
      const unreadOnly = activity === "unread" || activity === "unread-empty";
      const items =
        activity === "empty" || activity === "unread-empty"
          ? []
          : activityItems.filter(
              (item) => (filter === "all" || item.reasons.includes(filter)) && (!unreadOnly || item.unread),
            );
      return (
        <ActivityList
          filter={filter}
          unreadOnly={unreadOnly}
          items={items}
          hoveredKey={activity === "hover" ? activityItems[1].key : undefined}
        />
      );
    }
    case "later":
      return (
        <SavedList
          tab={savedTab}
          inProgressCount={saved === "empty" ? 0 : savedInProgress.length}
          items={savedItems}
          hoveredKey={saved === "row-hover" ? savedInProgress[0].key : undefined}
          openMenuKey={saved === "menu" ? savedInProgress[0].key : saved === "archived-menu" ? savedArchived[0].key : undefined}
        />
      );
  }
}

/** サイドバーだけを切り出したフレーム（足した「+」を見るため）。 */
export function sidebarFrame() {
  return (
    <div className="h-140 w-80 border-r border-border">
      <Sidebar
        workspace={workspaces.dev}
        currentUser={currentUser}
        rooms={rooms}
        selectedRoomId={selectedRoom.id}
        roomHref={roomHref}
        onCreateRoom={noop}
        onStartDm={noop}
      />
    </div>
  );
}

/** ルームのヘッダーだけを切り出したフレーム（足した設定のボタンを見るため）。 */
export function roomHeaderFrame() {
  return (
    <div className="w-180 bg-surface">
      <RoomHeader
        kind={selectedRoom.kind}
        name={selectedRoom.name}
        memberCount={selectedRoom.memberCount}
        onOpenSettings={noop}
        onToggleMembers={noop}
      />
    </div>
  );
}
