"use client";

import { useEffect, useMemo, useState } from "react";

import { RemoveSavedItemDialog } from "@/components/chat/room-dialogs";
import { SavedList } from "@/components/chat/saved-list";
import type { SavedTab } from "@/components/chat/types";
import { useAvatarUrls, useChatState, useChatStore } from "@/lib/chat/chat-provider";
import { toMemberNames, toSavedItemView } from "@/lib/chat/views";

/**
 * 「後で」（`/w/{id}/saved`。chat/saved/list.png。ADR 0054）。サイドバーの「後で」から開き、ルームの代わりにメインの領域に出す。
 * 行を押すと、そのメッセージへ飛ぶ（ADR 0042）。タブは画面の中の状態で、URL には持たない。
 */
export function WorkspaceSaved({ workspaceId, onBack }: { workspaceId: string; onBack: () => void }) {
  const store = useChatStore();
  const [tab, setTab] = useState<SavedTab>("in_progress");
  const [openMenuKey, setOpenMenuKey] = useState<string>();
  // 読めない行を押して、外すかどうかを確かめている保存（Slack と同じ流れ）
  const [confirming, setConfirming] = useState<{ messageId: string; pending: boolean } | null>(null);
  const saved = useChatState((s) => s.saved[workspaceId]);
  const current = saved?.tabs[tab];
  const workspaceMembers = useChatState((s) => s.members[workspaceId]);

  useEffect(() => {
    void store.loadSaved(workspaceId, tab);
  }, [store, workspaceId, tab]);

  const items = current?.items;
  const senderIds = useMemo(() => (items ?? []).flatMap((i) => (i.message ? [i.message.sender.id] : [])), [items]);
  const avatarUrls = useAvatarUrls(senderIds);
  // 本文のメンションは、ワークスペースのメンバーから名前を引く（別のルームのメッセージが並ぶため）
  const memberNames = useMemo(() => toMemberNames(workspaceMembers?.list), [workspaceMembers]);
  const views = useMemo(() => {
    const now = new Date();
    return (items ?? []).map((item) => toSavedItemView(item, { now, avatarUrls, memberNames }));
  }, [items, avatarUrls, memberNames]);

  function report(action: string) {
    return (err: unknown) => console.error(`failed to ${action} a saved message`, err);
  }

  async function confirmRemove() {
    if (!confirming) return;
    setConfirming({ ...confirming, pending: true });
    try {
      await store.removeSaved(workspaceId, confirming.messageId);
      setConfirming(null);
    } catch (err) {
      // 失敗の表示はデザインにない。押し直せるように戻す
      report("remove")(err);
      setConfirming((c) => c && { ...c, pending: false });
    }
  }

  return (
    <>
      <SavedList
        tab={tab}
        onChangeTab={(next) => {
          setOpenMenuKey(undefined);
          setTab(next);
        }}
        inProgressCount={saved?.inProgressCount ?? 0}
        // 取得中と失敗の画面はデザインにない。取れるまでは何も並べない（0 件の表示と取り違えないように）
        items={current?.status === "ready" ? views : undefined}
        onMove={(key, to) => {
          setOpenMenuKey(undefined);
          void store.moveSaved(workspaceId, key, to).catch(report("move"));
        }}
        onRemove={(key) => {
          setOpenMenuKey(undefined);
          void store.removeSaved(workspaceId, key).catch(report("remove"));
        }}
        onSelectUnavailable={(key) => setConfirming({ messageId: key, pending: false })}
        openMenuKey={openMenuKey}
        onToggleMenu={(key) => setOpenMenuKey((open) => (open === key ? undefined : key))}
        onReachEnd={() => void store.loadMoreSaved(workspaceId, tab)}
        onBack={onBack}
      />
      <RemoveSavedItemDialog
        open={confirming !== null}
        pending={confirming?.pending}
        onCancel={() => setConfirming(null)}
        onConfirm={confirmRemove}
      />
    </>
  );
}
