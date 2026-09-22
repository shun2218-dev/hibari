"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import type { AttachmentDraft, AttachmentUploader } from "@/lib/chat/media/uploads";

import { useChatContext } from "./use-chat-context";

/**
 * ルームの入力欄の添付。ルームの画面を開いている間だけ持ち、離れたら進行中のアップロードを打ち切る。
 */
export function useAttachmentUploader(roomId: string): { uploader: AttachmentUploader; drafts: AttachmentDraft[] } {
  const { createUploader } = useChatContext();
  const [uploader] = useState(() => createUploader(roomId));
  useEffect(() => () => uploader.abortAll(), [uploader]);
  const drafts = useSyncExternalStore(uploader.subscribe, uploader.getSnapshot, uploader.getSnapshot);
  return { uploader, drafts };
}
