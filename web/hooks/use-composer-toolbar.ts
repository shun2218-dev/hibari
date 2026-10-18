import { useSyncExternalStore } from "react";

import {
  composerToolbarVisible,
  serverComposerToolbarVisible,
  setComposerToolbarVisible,
  subscribeComposerToolbar,
} from "@/lib/composer-toolbar";

/** 入力欄の書式のツールバーを出すかどうかと、切り替える関数（lib/composer-toolbar.ts）。 */
export function useComposerToolbar(): [boolean, (visible: boolean) => void] {
  const visible = useSyncExternalStore(subscribeComposerToolbar, composerToolbarVisible, serverComposerToolbarVisible);
  return [visible, setComposerToolbarVisible];
}
