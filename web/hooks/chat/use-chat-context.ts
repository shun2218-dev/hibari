"use client";

import { useContext } from "react";

import { ChatContext, type ChatContextValue } from "@/providers/chat-provider";

/** ChatProvider の値。画面からは用途ごとのフック（useChatStore / useMedia など）を使う。 */
export function useChatContext(): ChatContextValue {
  const value = useContext(ChatContext);
  if (!value) throw new Error("chat hooks must be used inside ChatProvider");
  return value;
}
