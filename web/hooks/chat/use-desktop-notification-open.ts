"use client";

import { useEffect } from "react";

import { useChatContext } from "./use-chat-context";

/** ブラウザ通知を押したときの移動を、画面のルーターに任せる（ページを読み込み直さない）。 */
export function useDesktopNotificationOpen(open: (url: string) => void): void {
  const { desktop } = useChatContext();
  useEffect(() => {
    desktop?.setOpen(open);
  }, [desktop, open]);
}
