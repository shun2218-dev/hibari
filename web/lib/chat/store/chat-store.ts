import type { ChatApi } from "@/lib/chat/api";
import type { ChatStoreOptions } from "@/lib/chat/store/state";

import { createWorkspaces } from "./slices/workspaces";
import { createNotifications } from "./slices/notifications";
import { createActivity } from "./slices/activity";
import { createRead } from "./slices/read";
import { createPins } from "./slices/pins";
import { createSaved } from "./slices/saved";
import { createThreads } from "./slices/threads";
import { createTyping } from "./slices/typing";
import { createTimeline } from "./slices/timeline";
import { createHistory } from "./slices/history";
import { createSend } from "./slices/send";
import { createMessageActions } from "./slices/message-actions";
import { createRooms } from "./slices/rooms";
import { createEvents } from "./slices/events";
import { createStoreCore } from "./slices/core";

/**
 * チャットの状態のストア（ADR 0024 の session と同じく自作で、useSyncExternalStore で購読する）。
 *
 * 状態は置き換えるだけで、中身を書き換えない。変わった部分だけ新しいオブジェクトにするので、
 * コンポーネントは自分の見ている部分の参照が変わったときだけ描き直される。
 *
 * REST で取った状態に、WebSocket のイベント（applyEvent）を重ねる。イベントは落ちうるので、
 * 取りこぼしは change_seq で検出して差分を取り直す（syncTimeline。ADR 0014 / 0026）。
 *
 * 中身は slices/ の機能ごとのスライスに分けてある（ADR 0060 決定 5）。スライスは下の層（core → … → events）の
 * 関数だけを受け取って使い、ここは組み立てて公開メソッド（actions）を 1 つにまとめるだけにする。
 */
export function createChatStore(api: ChatApi, options: ChatStoreOptions) {
  const core = createStoreCore(api, options);
  const workspaces = createWorkspaces(core);
  const notifications = createNotifications(core);
  const activity = createActivity(core);
  const read = createRead(core, { activity });
  const pins = createPins(core);
  const saved = createSaved(core);
  const threads = createThreads(core, { activity });
  const typing = createTyping(core);
  const timeline = createTimeline(core, { read, pins, threads, typing });
  const history = createHistory(core, { timeline });
  const send = createSend(core, { timeline });
  const messageActions = createMessageActions(core, { timeline });
  const rooms = createRooms(core, { activity, saved, timeline, send });
  const events = createEvents(core, { workspaces, activity, saved, threads, typing, timeline, rooms });

  return {
    ...core.actions,
    ...workspaces.actions,
    ...notifications.actions,
    ...activity.actions,
    ...read.actions,
    ...pins.actions,
    ...saved.actions,
    ...threads.actions,
    ...typing.actions,
    ...timeline.actions,
    ...history.actions,
    ...send.actions,
    ...messageActions.actions,
    ...rooms.actions,
    ...events.actions,
  };
}

export type ChatStore = ReturnType<typeof createChatStore>;
