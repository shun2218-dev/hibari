"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useEffect, useEffectEvent, useState } from "react";
import { createPortal } from "react-dom";

import { HuddleDeviceMenu, HuddlePreview } from "@/components/chat/huddle-preview";
import { HuddleRing } from "@/components/chat/huddle-ring";
import { HuddleBar, HuddleProblemScreen, HuddleScreen } from "@/components/chat/huddle-screen";
import { useChatState, useChatStore } from "@/hooks/chat/use-chat-store";
import { useHuddle, useHuddleSurface } from "@/hooks/chat/use-huddle";
import { useHuddleView } from "@/hooks/chat/use-huddle-view";
import { useAvatarUrls } from "@/hooks/chat/use-media";
import { createRingtone } from "@/lib/chat/huddle/ringtone";
import { watchWindowInput } from "@/lib/chat/realtime/activity";
import { canPost } from "@/lib/chat/views/permissions";

import { RoomThread } from "./room-thread";

/**
 * 音声のハドル（ADR 0066）の、チャットのタブ側の係。
 *
 * - 通話しているルームのハドルの状態（huddle.updated）に合わせて、受ける音声を増やし・減らす（決定 9）
 * - 画面（参加前のプレビュー・ハドルの画面・知らせ）を、別のタブ（about:blank）に portal で描く。モバイルとタブを開けないときは全画面（追記 C）
 * - DM の呼び出しを出し、呼び出し音を鳴らす（決定 11）
 * - ショートカット（⌘⇧H で開始・参加・退出、⌘⇧Space でミュート）
 *
 * ハドルの帯（タブを閉じている間の、下の端の帯）は HuddleCallBar が ChatLayout の枠に描く。
 */
export function HuddleCall({ roomId }: { roomId?: string }) {
  const huddle = useHuddle();
  const store = useChatStore();
  const router = useRouter();
  const surface = useHuddleSurface();
  const { call, room, preview, screen } = useHuddleView();
  const enabled = useChatState((s) => s.features?.huddles ?? false);
  const currentRoom = useChatState((s) => (roomId ? s.rooms[roomId] : undefined));
  const [chatOpen, setChatOpen] = useState(false);
  const [deviceMenuOpen, setDeviceMenuOpen] = useState(false);
  const [previewMenu, setPreviewMenu] = useState<"mic" | "speaker">();

  // WebRTC のないブラウザでは、サーバーに聞くまでもなく使えない
  useEffect(() => {
    if (huddle) void store.loadFeatures();
  }, [store, huddle]);

  // 入っている人が変わったら、受ける音声を合わせる。ミュートの変化でも来るが、sync は差分だけを送る
  const roomHuddle = room?.huddle;
  const huddleId = call.phase === "call" ? call.huddleId : undefined;
  useEffect(() => {
    if (!huddle || !huddleId || !roomHuddle || roomHuddle.id !== huddleId) return;
    void huddle.call.sync(roomHuddle.participants.map((p) => p.user_id));
  }, [huddle, huddleId, roomHuddle]);

  // ハドルの画面を閉じたら、開いていたメニューとチャットも閉じる（次に開いたときは閉じた状態から）
  const shown = surface.kind !== "none";
  const [wasShown, setWasShown] = useState(shown);
  if (wasShown !== shown) {
    setWasShown(shown);
    if (!shown) {
      setChatOpen(false);
      setDeviceMenuOpen(false);
      setPreviewMenu(undefined);
    }
  }

  const canStartHere = huddle !== null && enabled && currentRoom !== undefined && canPost(currentRoom);
  const onShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (!huddle || !(event.metaKey || event.ctrlKey) || !event.shiftKey) return;
    if (event.code === "KeyH") {
      event.preventDefault();
      if (call.phase === "call") void huddle.call.leave();
      else if (canStartHere && roomId) huddle.surface.start(roomId);
    } else if (event.code === "Space" && call.phase === "call") {
      event.preventDefault();
      huddle.call.toggleMic();
    }
  });
  const popup = surface.kind === "popup" ? surface.window : undefined;
  useEffect(() => {
    const handler = (event: KeyboardEvent) => onShortcut(event);
    // ハドルのタブにフォーカスがあるときも効くよう、そちらの document でも聞く
    const docs = [document, ...(popup ? [popup.container.ownerDocument] : [])];
    for (const doc of docs) doc.addEventListener("keydown", handler);
    return () => {
      for (const doc of docs) doc.removeEventListener("keydown", handler);
    };
  }, [popup]);

  const roomLabel = room ? (room.kind === "dm" ? (room.dm_peer?.display_name ?? "") : `#${room.name ?? ""}`) : "";
  useEffect(() => {
    popup?.setTitle(roomLabel === "" ? "ハドルミーティング" : `ハドルミーティング: ${roomLabel}`);
  }, [popup, roomLabel]);

  if (!huddle) return null;
  const { call: controls } = huddle;

  let content: ReactNode = null;
  if (preview) {
    content = (
      <HuddlePreview
        preview={preview}
        openMenu={previewMenu}
        onToggleMenu={(menu) => setPreviewMenu((open) => (open === menu ? undefined : menu))}
        onToggleMic={() => controls.toggleMic()}
        onSelectMic={(id) => {
          setPreviewMenu(undefined);
          void controls.selectMic(id);
        }}
        onSelectSpeaker={(id) => {
          setPreviewMenu(undefined);
          controls.selectSpeaker(id);
        }}
        onCancel={() => controls.cancelPreview()}
        onStart={() => void controls.join()}
      />
    );
  } else if (screen && call.phase === "call" && room) {
    const messageId = room.huddle?.id === call.huddleId ? room.huddle?.message_id : undefined;
    content = (
      <HuddleScreen
        huddle={screen}
        chatOpen={chatOpen && messageId !== undefined}
        chat={
          messageId && (
            <RoomThread
              key={messageId}
              workspaceId={room.workspace_id}
              roomId={room.id}
              rootId={messageId}
              onClose={() => setChatOpen(false)}
              // プロフィールはチャットのタブに出す
              onOpenProfile={(userId) => {
                window.focus();
                router.push(`/w/${room.workspace_id}/r/${room.id}?p=${encodeURIComponent(userId)}`);
              }}
            />
          )
        }
        deviceMenu={
          deviceMenuOpen && (
            <HuddleDeviceMenu
              mics={call.mics}
              micId={call.micId}
              speakers={call.speakers}
              speakerId={call.speakerId}
              onSelectMic={(id) => {
                setDeviceMenuOpen(false);
                void controls.selectMic(id);
              }}
              onSelectSpeaker={(id) => {
                setDeviceMenuOpen(false);
                controls.selectSpeaker(id);
              }}
              onDismiss={() => setDeviceMenuOpen(false)}
            />
          )
        }
        onToggleMute={() => controls.toggleMic()}
        onToggleDeviceMenu={() => setDeviceMenuOpen((open) => !open)}
        onToggleChat={() => setChatOpen((open) => !open)}
        onLeave={() => void controls.leave()}
      />
    );
  } else if (call.phase === "problem" && room) {
    content = (
      <HuddleProblemScreen
        problem={call.problem}
        room={{ kind: room.kind, name: room.kind === "dm" ? (room.dm_peer?.display_name ?? "") : (room.name ?? "") }}
        onRetry={() => void controls.openPreview(room.id)}
        onClose={() => controls.dismissProblem()}
      />
    );
  }

  return (
    <>
      {popup && content && createPortal(content, popup.container)}
      {surface.kind === "overlay" && content && (
        <div role="dialog" aria-label="ハドルミーティング" className="fixed inset-0 z-50 overflow-y-auto">
          {content}
        </div>
      )}
      {enabled && <Ring />}
    </>
  );
}

/** DM の呼び出し（決定 11）。出している間、呼び出し音を鳴らす。 */
function Ring() {
  const huddle = useHuddle();
  const store = useChatStore();
  const ring = useChatState((s) => s.huddleRing);
  const room = useChatState((s) => (ring ? s.rooms[ring.roomId] : undefined));
  const callerName = useChatState((s) =>
    ring && room ? s.members[room.workspace_id]?.list.find((m) => m.user.id === ring.callerId)?.user.display_name : undefined,
  );
  const avatarUrls = useAvatarUrls(ring ? [ring.callerId] : []);
  const [ringtone] = useState(createRingtone);

  // 自動再生の制限があるので、このタブで操作があったときに鳴らせるようにしておく
  useEffect(() => watchWindowInput(() => ringtone.unlock()), [ringtone]);
  const ringing = ring !== null;
  useEffect(() => {
    if (!ringing) return;
    ringtone.start();
    return () => ringtone.stop();
  }, [ringing, ringtone]);

  if (!ring || !huddle) return null;
  const caller = {
    id: ring.callerId,
    name: callerName ?? (room?.dm_peer?.id === ring.callerId ? room.dm_peer.display_name : "メンバー"),
    avatarUrl: avatarUrls[ring.callerId] ?? undefined,
  };
  return (
    <HuddleRing
      caller={caller}
      onJoin={() => {
        store.dismissHuddleRing();
        huddle.surface.start(ring.roomId);
      }}
      onJoinSoon={() => void store.huddleJoiningSoon(ring.huddleId).catch(() => {})}
    />
  );
}

/**
 * ハドルの帯（追記 C）。通話していて、ハドルのタブを開いていない間だけ、チャットのタブの下の端に出す。
 * ハドルのチャットは、チャットのタブの右のパネル（スレッド）で開く。
 */
export function HuddleCallBar() {
  const huddle = useHuddle();
  const router = useRouter();
  const searchParams = useSearchParams();
  const surface = useHuddleSurface();
  const { call, room, screen } = useHuddleView();
  const [deviceMenuOpen, setDeviceMenuOpen] = useState(false);

  if (!huddle || surface.kind !== "none" || call.phase !== "call" || !screen || !room) return null;
  const messageId = room.huddle?.id === call.huddleId ? room.huddle?.message_id : undefined;
  const chatOpen = messageId !== undefined && searchParams.get("t") === messageId;
  const { call: controls } = huddle;
  return (
    <HuddleBar
      huddle={screen}
      chatOpen={chatOpen}
      deviceMenu={
        deviceMenuOpen && (
          <HuddleDeviceMenu
            mics={call.mics}
            micId={call.micId}
            speakers={call.speakers}
            speakerId={call.speakerId}
            onSelectMic={(id) => {
              setDeviceMenuOpen(false);
              void controls.selectMic(id);
            }}
            onSelectSpeaker={(id) => {
              setDeviceMenuOpen(false);
              controls.selectSpeaker(id);
            }}
            onDismiss={() => setDeviceMenuOpen(false)}
          />
        )
      }
      onToggleMute={() => controls.toggleMic()}
      onToggleDeviceMenu={() => setDeviceMenuOpen((open) => !open)}
      onToggleChat={
        messageId
          ? () => {
              const base = `/w/${room.workspace_id}/r/${room.id}`;
              if (chatOpen) router.replace(base);
              else router.push(`${base}?t=${encodeURIComponent(messageId)}`);
            }
          : undefined
      }
      onPopOut={() => huddle.surface.show()}
      onLeave={() => void controls.leave()}
    />
  );
}
