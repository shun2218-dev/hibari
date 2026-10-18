"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";

import { useChatStore } from "./use-chat-store";

/**
 * 「DM を送る」（ADR 0050 決定 4）。既存の DM があれば同じルームが返る（`dm_key`）ので、サーバーに足すものはない。
 * 応答を待つ間はもう一度押させない（二重に送っても結果は同じだが、画面の遷移が 2 回起きる）。
 */
export function useOpenDm(workspaceId: string, onOpened?: () => void) {
  const router = useRouter();
  const store = useChatStore();
  const [pending, setPending] = useState(false);
  // state は再描画まで古い値のままなので、同じ描画の中の連打は ref で止める
  const inflight = useRef(false);

  const open = useCallback(
    async (userId: string) => {
      if (inflight.current) return;
      inflight.current = true;
      setPending(true);
      try {
        const room = await store.openDm(workspaceId, userId);
        onOpened?.();
        router.push(`/w/${workspaceId}/r/${room.id}`);
      } catch (err) {
        // 相手がワークスペースを抜けた（422）などの表示はデザインにない（StartDm と同じ）
        console.error("failed to open a dm", err);
      } finally {
        inflight.current = false;
        setPending(false);
      }
    },
    [store, workspaceId, router, onOpened],
  );
  return { open, pending };
}
