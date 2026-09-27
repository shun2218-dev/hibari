"use client";

import { useMemo, useState } from "react";

import { type NewHuddleCandidate, NewHuddleDialog } from "@/components/chat/dialogs/new-huddle";
import { useSessionState } from "@/hooks/auth/use-session";
import { useChatState, useChatStore } from "@/hooks/chat/use-chat-store";
import { useHuddle } from "@/hooks/chat/use-huddle";
import { useAvatarUrls } from "@/hooks/chat/use-media";
import { placeView } from "@/lib/chat/views/huddles";
import { toDmCandidates } from "@/lib/chat/views/members";
import { canPost } from "@/lib/chat/views/permissions";

/**
 * 「＋ 新規ハドルミーティング」（ADR 0067 決定 8）。名前を選べばその人との DM、チャンネルを選べばそのチャンネルで、
 * 参加前のプレビューを出す（いきなり入らない）。選べるチャンネルは、自分が投稿できる（入れる）ものだけ。
 */
export function NewHuddle({ workspaceId, open, onClose }: { workspaceId: string; open: boolean; onClose: () => void }) {
  const store = useChatStore();
  const huddle = useHuddle();
  const { state: sessionState } = useSessionState();
  const me = sessionState.status === "signed_in" ? sessionState.user : undefined;
  const members = useChatState((s) => s.members[workspaceId]);
  const roomList = useChatState((s) => s.roomLists[workspaceId]);
  const rooms = useChatState((s) => s.rooms);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string>();
  const [starting, setStarting] = useState(false);

  const users = useMemo(() => toDmCandidates(members?.list ?? [], { userId: me?.id ?? "", search }), [members, me, search]);
  const avatarUrls = useAvatarUrls(useMemo(() => users.map((u) => u.id), [users]));
  const candidates = useMemo((): NewHuddleCandidate[] => {
    const q = search.trim().toLowerCase();
    const channels = (roomList?.ids ?? []).flatMap((id) => {
      const room = rooms[id];
      if (!room || room.kind === "dm" || !canPost(room)) return [];
      const view = placeView(room);
      return q === "" || view.name.toLowerCase().includes(q) ? [{ kind: "room" as const, id: room.id, room: view }] : [];
    });
    return [
      ...users.map((u): NewHuddleCandidate => ({ kind: "user", id: u.id, user: { ...u, avatarUrl: avatarUrls[u.id] ?? undefined } })),
      ...channels,
    ];
  }, [search, roomList, rooms, users, avatarUrls]);

  function close() {
    setSearch("");
    setSelected(undefined);
    onClose();
  }

  async function start() {
    if (!huddle || selected === undefined) return;
    const [kind, id] = selected.split(":");
    if (kind === "room") {
      huddle.surface.start(id);
      close();
      return;
    }
    // DM を作るのを待つ間に操作の中でなくなるので、先に画面（別のタブ）を開いておく
    huddle.surface.show();
    setStarting(true);
    try {
      const room = await store.openDm(workspaceId, id);
      huddle.surface.start(room.id);
      close();
    } catch (err) {
      // 相手がワークスペースを抜けた（422）などの表示はデザインにない。ダイアログを残して選び直せるようにする
      console.error("failed to open a dm for a huddle", err);
      huddle.surface.hide();
    } finally {
      setStarting(false);
    }
  }

  return (
    <NewHuddleDialog
      open={open}
      search={search}
      onSearchChange={setSearch}
      candidates={candidates}
      selected={selected}
      onSelect={setSelected}
      onCancel={close}
      onStart={() => void start()}
      starting={starting}
    />
  );
}
