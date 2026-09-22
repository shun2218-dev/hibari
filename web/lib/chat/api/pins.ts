import type { Message, PinList } from "@/lib/api/types.gen";
import type { Session } from "@/lib/auth/session";

import { messagePath } from "./messages";

/**
 * ピン留め（ADR 0054）。
 */
export function createPinApi(request: Session["request"]) {
  return {
    /** ピン留め（ADR 0054 決定 5）。ピン留め済みでも 200 で、更新後のメッセージを返す（冪等）。 */
    pinMessage: (roomId: string, messageId: string) =>
      request<Message>("PUT", `${messagePath(roomId, messageId)}/pin`),

    /** ピンを外す。ピン留めされていなくても 200（冪等）。 */
    unpinMessage: (roomId: string, messageId: string) =>
      request<Message>("DELETE", `${messagePath(roomId, messageId)}/pin`),

    /** ピン留めした新しい順。上限が 100 件なのでページングしない（ADR 0054 決定 5）。 */
    listPins: (roomId: string) => request<PinList>("GET", `/api/v1/rooms/${encodeURIComponent(roomId)}/pins`),
  };
}
