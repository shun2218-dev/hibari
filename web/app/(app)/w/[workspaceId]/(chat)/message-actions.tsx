"use client";

import { type ReactNode, useEffect, useState, useSyncExternalStore } from "react";

import { EmojiPicker } from "@/components/chat/emoji-picker";
import { ImageViewer } from "@/components/chat/image-viewer";
import type { MessageEditingView } from "@/components/chat/message-item";
import { DeleteAttachmentDialog, DeleteMessageDialog } from "@/components/chat/room-dialogs";
import type { MessageActions } from "@/components/chat/timeline";
import { ApiError } from "@/lib/api/error";
import type { Message, Role, Room, UserProfile } from "@/lib/api/types.gen";
import { useChatStore, useMedia, useMediaState } from "@/lib/chat/chat-provider";
import { buildPermalink } from "@/lib/chat/links";
import type { MentionCandidate } from "@/lib/chat/mentions";
import { useOrigin } from "@/lib/chat/use-origin";
import { isPreviewImage, messageActions } from "@/lib/chat/views";
import { currentTheme, serverTheme, subscribeTheme } from "@/lib/theme";

/** コピーの結果をメニューに出しておく時間。 */
const COPIED_LABEL_MS = 2_000;

/**
 * ブラウザにダウンロードさせる。GET URL は Content-Disposition: attachment で署名してある（ADR 0013）ので、
 * 開いてもページは移らずに保存が始まる。
 */
function startDownload(url: string) {
  const link = document.createElement("a");
  link.href = url;
  link.rel = "noopener";
  link.click();
}

/**
 * メッセージの「…」メニュー・その場での編集・削除の確認（ADR 0027）と、「リンクをコピー」（ADR 0040）。
 * チャンネルのタイムラインと、スレッドのパネル（ADR 0036）の両方で使う。操作の可否の規則は同じ（ADR 0012）。
 */
export function useMessageActions({
  workspaceId,
  roomId,
  room,
  messages,
  me,
  myRole,
  members,
  mentionCandidates = [],
  canReact = false,
}: {
  workspaceId: string;
  roomId: string;
  room: Room | undefined;
  /** 操作の対象になりうるメッセージ（タイムラインに出しているもの）。 */
  messages: readonly Message[] | undefined;
  me: UserProfile | undefined;
  myRole: Role | undefined;
  /** 送信者のロールを引くためのルームのメンバー。取れていなければ undefined。 */
  members: readonly { user: { id: string }; role: Role }[] | undefined;
  /** 編集で `<@ULID>` を `@ハンドル` に戻し、保存で戻すのに使う候補（ADR 0043）。 */
  mentionCandidates?: readonly MentionCandidate[];
  /**
   * 絵文字のリアクションを付けられるか（ADR 0044 決定 6）。投稿できる人だけ。
   * 参加していない public ルームは読めるだけなので false にする。
   */
  canReact?: boolean;
}): {
  timelineProps: {
    actionsFor: (key: string) => MessageActions;
    copyLinkFor: (key: string) => { label: string; onClick: () => void } | undefined;
    openMenuKey: string | undefined;
    onToggleMenu: (key: string) => void;
    onEdit: (key: string) => void;
    onDelete: (key: string) => void;
    editingKey: string | undefined;
    editing: MessageEditingView | undefined;
    onToggleReaction: ((key: string, emoji: string) => void) | undefined;
    onTogglePicker: ((key: string) => void) | undefined;
    openPickerKey: string | undefined;
    reactionPicker: ReactNode;
    onDownload: (attachmentId: string) => void;
    onOpenImage: (key: string, attachmentId: string) => void;
    onDeleteAttachment: (key: string, attachmentId: string) => void;
    openAttachmentMenu: { key: string; attachmentId: string } | undefined;
    onToggleAttachmentMenu: (key: string, attachmentId: string) => void;
  };
  /** タイムラインの上に重ねるもの（削除の確認と、画像の拡大表示）。呼ぶ側はそのまま置く。 */
  overlays: ReactNode;
} {
  const store = useChatStore();
  const media = useMedia();
  // 拡大表示に出す画像の URL。タイムラインに出ている画像はすでに取ってある（ADR 0028 / 0045 決定 4）
  const attachmentUrls = useMediaState((s) => s.attachments);
  const [openMenuKey, setOpenMenuKey] = useState<string>();
  const [openPickerKey, setOpenPickerKey] = useState<string>();
  // emoji-mart はテーマを props で受け取るので、`data-theme` を購読して渡す（ADR 0031 / 0044）
  const theme = useSyncExternalStore(subscribeTheme, currentTheme, serverTheme);
  const [editing, setEditing] = useState<{ messageId: string; value: string; saving: boolean } | null>(null);
  const [deleting, setDeleting] = useState<{
    messageId: string;
    body: string;
    mentionNames: Record<string, string>;
    pending: boolean;
  } | null>(null);
  // 拡大表示で開いている画像（ADR 0045）。null なら開いていない
  const [viewing, setViewing] = useState<{ messageId: string; attachmentId: string } | null>(null);
  const [openAttachmentMenu, setOpenAttachmentMenu] = useState<{ key: string; attachmentId: string }>();
  const [deletingAttachment, setDeletingAttachment] = useState<{
    messageId: string;
    attachmentId: string;
    fileName: string;
    /** これが最後の添付で本文も空（消すとメッセージごと消える。ADR 0045 決定 8）。 */
    alsoDeletesMessage: boolean;
    pending: boolean;
  } | null>(null);
  // コピーの結果は、メニューの項目の文言を短い間だけ変えて伝える（トーストの仕組みを新しく作らない。ADR 0040）
  const [copied, setCopied] = useState<{ messageId: string; ok: boolean } | null>(null);
  const origin = useOrigin();
  // 編集のときは入力欄と同じ `@ハンドル` の形で見せ、保存するときに保存の形へ戻す（ADR 0043）

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), COPIED_LABEL_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const findMessage = (key: string) => messages?.find((m) => m.id === key);
  // 編集中に削除された（別のタブ、管理者）ら、編集をやめる
  const editingMessage = editing ? findMessage(editing.messageId) : undefined;
  const activeEditing = editing && editingMessage?.deleted_at === null ? editing : null;

  /** そのメッセージの、インライン表示している画像だけ（送れる範囲。ADR 0045 決定 2）。並びは添付の順のまま。 */
  function imagesOf(messageId: string) {
    const message = findMessage(messageId);
    if (!message || message.deleted_at !== null) return [];
    return message.attachments
      .filter(isPreviewImage)
      .map((a) => ({ id: a.id, fileName: a.file_name, url: attachmentUrls[a.id] ?? undefined }));
  }

  const viewerImages = viewing ? imagesOf(viewing.messageId) : [];
  // 開いていた画像が無くなったら（ほかの人が消した、メッセージごと消えた、読めなくなった）、拡大表示も出さない。
  // 自分が消したときは、次の画像に送るか閉じるかを確定のときに決める（confirmDeleteAttachment）
  const viewerIndex = viewing ? viewerImages.findIndex((image) => image.id === viewing.attachmentId) : -1;

  function actionsFor(key: string): MessageActions {
    const message = findMessage(key);
    // 送信中のメッセージはまだ ID がないので、編集も削除もできない
    if (!message || !me || !room) return { canEdit: false, canDelete: false };
    const senderRole = members?.find((m) => m.user.id === message.sender.id)?.role;
    return messageActions(message, { userId: me.id, room, myRole, senderRole });
  }

  /**
   * メッセージへのパーマリンクをコピーする（ADR 0040）。
   * 読めている人なら誰でもコピーできるので、権限では出し分けない。送信中のメッセージにはまだ ID がないので出さない。
   */
  function copyLinkFor(key: string): { label: string; onClick: () => void } | undefined {
    const message = findMessage(key);
    if (!message || origin === undefined || message.deleted_at !== null) return undefined;
    if (copied?.messageId === message.id) {
      return { label: copied.ok ? "コピーしました" : "コピーできませんでした", onClick: () => {} };
    }
    return {
      label: "リンクをコピー",
      onClick: async () => {
        const href = buildPermalink(origin, {
          workspaceId,
          roomId,
          messageId: message.id,
          ...(message.thread_root_id !== null ? { threadRootId: message.thread_root_id } : {}),
        });
        try {
          await navigator.clipboard.writeText(href);
          setCopied({ messageId: message.id, ok: true });
        } catch (err) {
          // クリップボードが使えない・拒否された。document.execCommand の代替は入れない（非推奨）
          console.error("failed to copy a message link", err);
          setCopied({ messageId: message.id, ok: false });
        }
      },
    };
  }

  async function saveEdit() {
    if (!activeEditing || !editingMessage) return;
    // 編集欄の値は送る形のテキスト（ADR 0052 決定 3）
    const body = activeEditing.value;
    if (body === editingMessage.body) {
      setEditing(null);
      return;
    }
    setEditing({ ...activeEditing, saving: true });
    try {
      await store.editMessage(roomId, activeEditing.messageId, body);
      setEditing(null);
    } catch (err) {
      // 失敗の表示はデザインにない。消されていた（409）・読めなくなった（404）なら閉じ、それ以外は保存し直せるように戻す
      console.error("failed to edit message", err);
      if (err instanceof ApiError && (err.status === 404 || err.status === 409)) setEditing(null);
      else setEditing((current) => current && { ...current, saving: false });
    }
  }

  /**
   * リアクションを付け外しする（ADR 0044）。楽観的更新と元に戻すのはデータ層（store）の仕事。
   * 失敗の表示はデザインにないので、ここでは戻った結果をそのまま見せる。
   */
  function toggleReaction(key: string, emoji: string) {
    void store.toggleReaction(roomId, key, emoji).catch((err: unknown) => {
      console.error("failed to toggle a reaction", err);
    });
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeleting({ ...deleting, pending: true });
    try {
      await store.deleteMessage(roomId, deleting.messageId);
      setDeleting(null);
    } catch (err) {
      // 失敗の表示はデザインにない。権限がない（403）・見つからない（404）なら閉じ、それ以外は押し直せるように戻す
      console.error("failed to delete message", err);
      if (err instanceof ApiError && (err.status === 403 || err.status === 404)) setDeleting(null);
      else setDeleting((current) => current && { ...current, pending: false });
    }
  }

  /**
   * 添付の削除の確認を開く（ADR 0045 決定 9）。取り消せない操作なので、楽観的更新はしない。
   * 最後の 1 件で本文も空なら、メッセージごと消えることを先に伝える（決定 8）。
   */
  function askDeleteAttachment(key: string, attachmentId: string) {
    setOpenAttachmentMenu(undefined);
    const message = findMessage(key);
    const attachment = message?.attachments.find((a) => a.id === attachmentId);
    if (!message || !attachment) return;
    setDeletingAttachment({
      messageId: message.id,
      attachmentId,
      fileName: attachment.file_name,
      alsoDeletesMessage: message.attachments.length === 1 && message.body.trim() === "",
      pending: false,
    });
  }

  async function confirmDeleteAttachment() {
    if (!deletingAttachment) return;
    const { messageId, attachmentId } = deletingAttachment;
    // 拡大表示から消したときの送り先。次がなければ前、どちらもなければ閉じる（ADR 0045 の「結果」）
    const images = imagesOf(messageId);
    const at = images.findIndex((image) => image.id === attachmentId);
    const nextImage = images[at + 1] ?? images[at - 1];
    setDeletingAttachment({ ...deletingAttachment, pending: true });
    try {
      await store.deleteAttachment(roomId, messageId, attachmentId);
      if (viewing?.attachmentId === attachmentId) {
        setViewing(nextImage ? { messageId, attachmentId: nextImage.id } : null);
      }
      setDeletingAttachment(null);
    } catch (err) {
      // 失敗の表示はデザインにない。権限がない（403）・見つからない（404）なら閉じ、それ以外は押し直せるように戻す
      console.error("failed to delete an attachment", err);
      if (err instanceof ApiError && (err.status === 403 || err.status === 404)) setDeletingAttachment(null);
      else setDeletingAttachment((current) => current && { ...current, pending: false });
    }
  }

  /** 押されるたびに GET URL を取り直してダウンロードさせる（手元の URL は期限が近いかもしれない。ADR 0028）。 */
  async function download(attachmentId: string) {
    try {
      startDownload(await media.attachmentDownloadUrl(attachmentId));
    } catch (err) {
      // 失敗の表示はデザインにない
      console.error("failed to download an attachment", err);
    }
  }

  return {
    timelineProps: {
      actionsFor,
      copyLinkFor,
      openMenuKey,
      onToggleMenu: (key) => setOpenMenuKey((current) => (current === key ? undefined : key)),
      onEdit: (key) => {
        setOpenMenuKey(undefined);
        const message = findMessage(key);
        if (message) setEditing({ messageId: message.id, value: message.body, saving: false });
      },
      onDelete: (key) => {
        setOpenMenuKey(undefined);
        const message = findMessage(key);
        // 引用は本文と同じ解釈で出す（書式とメンションのチップ。ADR 0051）
        if (message)
          setDeleting({
            messageId: message.id,
            body: message.body,
            mentionNames: Object.fromEntries(message.mentions.flatMap((m) => (m.user ? [[m.user.id, m.user.display_name]] : []))),
            pending: false,
          });
      },
      onDownload: (attachmentId) => void download(attachmentId),
      onOpenImage: (key, attachmentId) => {
        setOpenMenuKey(undefined);
        setOpenPickerKey(undefined);
        setViewing({ messageId: key, attachmentId });
      },
      onDeleteAttachment: askDeleteAttachment,
      openAttachmentMenu,
      onToggleAttachmentMenu: (key, attachmentId) =>
        setOpenAttachmentMenu((current) =>
          current?.key === key && current.attachmentId === attachmentId ? undefined : { key, attachmentId },
        ),
      onToggleReaction: canReact ? toggleReaction : undefined,
      onTogglePicker: canReact
        ? (key) => {
            setOpenMenuKey(undefined);
            setOpenPickerKey((current) => (current === key ? undefined : key));
          }
        : undefined,
      openPickerKey: canReact ? openPickerKey : undefined,
      reactionPicker: openPickerKey === undefined ? null : (
        <EmojiPicker
          theme={theme}
          onPick={(emoji) => {
            toggleReaction(openPickerKey, emoji);
            setOpenPickerKey(undefined);
          }}
        />
      ),
      editingKey: activeEditing?.messageId,
      editing: activeEditing
        ? {
            value: activeEditing.value,
            mentionCandidates,
            saving: activeEditing.saving,
            onChange: (value) => setEditing({ ...activeEditing, value }),
            onSave: saveEdit,
            onCancel: () => setEditing(null),
          }
        : undefined,
    },
    overlays: (
      <>
        <DeleteMessageDialog
          open={deleting !== null}
          body={deleting?.body ?? ""}
          mentionNames={deleting?.mentionNames}
          pending={deleting?.pending}
          onCancel={() => setDeleting(null)}
          onConfirm={confirmDelete}
        />
        <DeleteAttachmentDialog
          open={deletingAttachment !== null}
          fileName={deletingAttachment?.fileName ?? ""}
          alsoDeletesMessage={deletingAttachment?.alsoDeletesMessage}
          pending={deletingAttachment?.pending}
          onCancel={() => setDeletingAttachment(null)}
          onConfirm={confirmDeleteAttachment}
        />
        {viewing !== null && viewerIndex >= 0 && (
          <ImageViewer
            images={viewerImages}
            index={viewerIndex}
            onMove={(next) => setViewing({ messageId: viewing.messageId, attachmentId: viewerImages[next].id })}
            onClose={() => setViewing(null)}
            onDownload={(attachmentId) => void download(attachmentId)}
            // 消せる人にだけ出す（判定はメッセージの削除と同じ。ADR 0045 決定 5）
            onDelete={
              actionsFor(viewing.messageId).canDelete
                ? (attachmentId) => askDeleteAttachment(viewing.messageId, attachmentId)
                : undefined
            }
            onImageError={(id, url) => media.attachmentImageFailed(id, url)}
          />
        )}
      </>
    ),
  };
}
