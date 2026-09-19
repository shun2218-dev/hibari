"use client";

import { useEffect, useMemo, useState } from "react";

import { AddRoomMemberDialog, LeaveRoomDialog, RoomSettingsDialog } from "@/components/chat/room-dialogs";
import { useSessionState } from "@/lib/auth/session-provider";
import { useAvatarUrls, useChatState, useChatStore } from "@/lib/chat/chat-provider";
import { roomName, toDmCandidates, toRoomMemberRows } from "@/lib/chat/views";

/**
 * チャンネルの設定（`chat/room-settings-dialog.png`）。名前の変更と、非公開チャンネルのメンバーの出し入れ。
 *
 * 変更できるのは、そのチャンネルを読める admin 以上（ADR 0011）。member にも読み取り専用で開ける。
 * DM は設定を変えられないので、ヘッダーに入口を出さない（RoomView）。
 *
 * 参加していれば、ロールに関係なくここから退出できる。退出したあとの画面（非公開なら入口に戻る、
 * 公開なら参加していない状態で読み続ける）は、別の端末で退出したときと同じく RoomView が決める。
 */
export function RoomSettings({
  workspaceId,
  roomId,
  open,
  onClose,
}: {
  workspaceId: string;
  roomId: string;
  open: boolean;
  onClose: () => void;
}) {
  const store = useChatStore();
  const { state: sessionState } = useSessionState();
  const room = useChatState((s) => s.rooms[roomId]);
  const roomMembers = useChatState((s) => s.roomMembers[roomId]?.members);
  const workspaceMembers = useChatState((s) => s.members[workspaceId]);
  const myRole = useChatState((s) => s.workspaces.list.find((w) => w.id === workspaceId)?.my_role);

  const [name, setName] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string>();
  const [pending, setPending] = useState(false);
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const isPrivate = room?.kind === "private";

  // 開いている間だけ、メンバー（チャンネルとワークスペース）を取る
  useEffect(() => {
    if (!open || !isPrivate) return;
    store.loadRoomMembers(roomId);
    store.loadMembers(workspaceId);
  }, [open, isPrivate, store, roomId, workspaceId]);

  const me = sessionState.status === "signed_in" ? sessionState.user : undefined;
  const memberIds = useMemo(() => (roomMembers ?? []).map((m) => m.user.id), [roomMembers]);
  const candidates = useMemo(
    () => toDmCandidates(workspaceMembers?.list ?? [], { userId: me?.id ?? "", search, exclude: memberIds }),
    [workspaceMembers, me, search, memberIds],
  );
  const avatarUrls = useAvatarUrls(useMemo(() => [...memberIds, ...candidates.map((c) => c.id)], [memberIds, candidates]));
  const rows = useMemo(
    () => toRoomMemberRows(roomMembers ?? [], { userId: me?.id ?? "", myRole, avatarUrls }),
    [roomMembers, me, myRole, avatarUrls],
  );

  if (!room || room.kind === "dm") return null;
  const canEdit = myRole !== undefined && myRole !== "member";

  function close() {
    setName(undefined);
    setSearch("");
    setSelectedId(undefined);
    onClose();
  }

  async function save() {
    const next = (name ?? "").trim();
    if (!room || next === "" || next === roomName(room)) {
      close();
      return;
    }
    setSaving(true);
    try {
      await store.updateRoom(roomId, { name: next });
      close();
    } catch (err) {
      // 名前の重複（409 room-name-taken）や通信の失敗の表示はデザインにない。ダイアログを残して直せるようにする
      console.error("failed to rename the room", err);
    } finally {
      setSaving(false);
    }
  }

  async function addMember() {
    if (!selectedId) return;
    setPending(true);
    try {
      await store.addRoomMember(roomId, selectedId);
      setAdding(false);
      setSearch("");
      setSelectedId(undefined);
    } catch (err) {
      console.error("failed to add a room member", err);
    } finally {
      setPending(false);
    }
  }

  async function leave() {
    setLeaving(true);
    try {
      await store.leaveRoom(roomId);
      setConfirmingLeave(false);
      close();
    } catch (err) {
      // 退出の失敗の表示はデザインにない（ワークスペースの退出と同じ）。確認を残して押し直せるようにする
      console.error("failed to leave the room", err);
    } finally {
      setLeaving(false);
    }
  }

  async function removeMember(userId: string) {
    try {
      await store.removeRoomMember(roomId, userId);
    } catch (err) {
      console.error("failed to remove a room member", err);
    }
  }

  return (
    <>
      <RoomSettingsDialog
        open={open && !adding && !confirmingLeave}
        kind={room.kind}
        name={name ?? roomName(room)}
        members={rows.map((row) => ({ ...row, avatarUrl: avatarUrls[row.id] ?? undefined }))}
        canEdit={canEdit}
        onNameChange={setName}
        onAddMember={() => setAdding(true)}
        onRemoveMember={removeMember}
        onLeave={room.is_member ? () => setConfirmingLeave(true) : undefined}
        onCancel={close}
        onSave={save}
        saving={saving}
      />
      <AddRoomMemberDialog
        open={open && adding}
        candidates={candidates.map((c) => ({ ...c, avatarUrl: avatarUrls[c.id] ?? undefined }))}
        selectedId={selectedId}
        search={search}
        onSearchChange={setSearch}
        onSelect={setSelectedId}
        onCancel={() => {
          setAdding(false);
          setSearch("");
          setSelectedId(undefined);
        }}
        onAdd={addMember}
        adding={pending}
      />
      <LeaveRoomDialog
        open={open && confirmingLeave}
        kind={room.kind}
        name={roomName(room)}
        pending={leaving}
        // やめたら設定に戻る（設定から開いたので）
        onCancel={() => setConfirmingLeave(false)}
        onConfirm={leave}
      />
    </>
  );
}
