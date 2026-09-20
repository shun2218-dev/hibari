/**
 * /dev/preview で再現する画面の一覧。名前は docs/ui/screenshots/ の PNG のパス（拡張子なし）と 1 対 1 に対応させ、
 * どのスクリーンショットと見比べればよいかを名前だけで分かるようにする（catalog.test.ts が対応を検査する）。
 */

export type PreviewGroup = "auth" | "chat" | "invite" | "workspace" | "settings";

/**
 * その画面を足したフェーズ。`docs/ui/README.md` から機械的に決める（同じ規則で足す）:
 * 取り込みの表（「### …で足した画面」より前）に載っている画面は "1.5"、
 * それ以降の「…で足した画面」で初めて出てくる画面はそのフェーズ。
 * "6" は、フェーズの節を持たずに Phase 6 の途中で足した画面（チャンネルの退出など）。
 */
export type PreviewSince = "1.5" | "6-1" | "6-2" | "6" | "6.4" | "6.5" | "6.6" | "6.7" | "6.11" | "6.13";

export type PreviewEntry = {
  name: string;
  title: string;
  /** ダークテーマで描く（名前が -dark で終わるもの）。 */
  dark?: boolean;
  /** モバイルのレイアウトで見る（ブラウザの幅を 768px 未満にする）。 */
  mobile?: boolean;
  /** どのフェーズで足したか。一覧の絞り込みに使う。 */
  since: PreviewSince;
};

export const previewGroups: Record<PreviewGroup, string> = {
  auth: "認証",
  chat: "チャット",
  invite: "招待の受け入れ",
  workspace: "ワークスペースの管理",
  settings: "ユーザー設定",
};

/** 絞り込みに出す順。新しいフェーズを足したら、いちばん後ろに足す。 */
export const previewSinceOrder: PreviewSince[] = ["1.5", "6-1", "6-2", "6", "6.4", "6.5", "6.6", "6.7", "6.11", "6.13"];

export const previewSinceLabels: Record<PreviewSince, string> = {
  "1.5": "1.5 取り込み",
  "6-1": "6-1",
  "6-2": "6-2",
  "6": "6 随時",
  "6.4": "6.4 システム",
  "6.5": "6.5 スレッド",
  "6.6": "6.6 チャンネルにも",
  "6.7": "6.7 リアクション",
  "6.11": "6.11 リンク",
  "6.13": "6.13 メンション",
};

export const previewCatalog: PreviewEntry[] = [
  { name: "auth/login", title: "ログイン", since: "1.5" },
  { name: "auth/login-error-credentials", title: "ログイン: 認証情報の誤り", since: "1.5" },
  { name: "auth/login-error-rate-limit", title: "ログイン: 試行回数の上限", since: "1.5" },
  { name: "auth/login-dark", title: "ログイン（ダーク）", dark: true, since: "1.5" },
  { name: "auth/mobile-login", title: "ログイン（モバイル）", mobile: true, since: "1.5" },
  { name: "auth/signup", title: "アカウントを作成", since: "1.5" },
  { name: "auth/forgot", title: "パスワードの再設定を依頼", since: "1.5" },
  { name: "auth/forgot-error-rate-limit", title: "再設定メールの依頼: 回数制限", since: "6-2" },
  { name: "auth/forgot-sent", title: "再設定メールを送信済み", since: "1.5" },
  { name: "auth/reset", title: "新しいパスワードを設定", since: "1.5" },
  { name: "auth/reset-error-invalid-input", title: "新しいパスワード: 入力エラー", since: "6-2" },
  { name: "auth/reset-done", title: "パスワードを変更済み", since: "1.5" },
  { name: "auth/reset-invalid", title: "再設定リンクが無効", since: "1.5" },
  { name: "auth/verify-pending", title: "メール確認待ち", since: "1.5" },
  { name: "auth/verify-checking", title: "メールを確認中", since: "1.5" },
  { name: "auth/verify-done", title: "メール確認済み", since: "1.5" },
  { name: "auth/verify-invalid", title: "確認リンクが無効", since: "1.5" },

  { name: "chat/default", title: "チャット（未読・入力中）", since: "1.5" },
  { name: "chat/default-dark", title: "チャット（ダーク）", dark: true, since: "1.5" },
  { name: "chat/messages-all-states", title: "メッセージの全状態", since: "1.5" },
  { name: "chat/messages-all-states-dark", title: "メッセージの全状態（ダーク）", dark: true, since: "1.5" },
  { name: "chat/message-hover-actions", title: "メッセージのホバー操作", since: "1.5" },
  { name: "chat/banner-reconnecting", title: "再接続中バナー", since: "1.5" },
  { name: "chat/banner-syncing", title: "同期中バナー", since: "1.5" },
  { name: "chat/banner-restored", title: "復帰バナー", since: "1.5" },
  { name: "chat/attachment-uploading", title: "添付: アップロード中", since: "1.5" },
  { name: "chat/attachment-failed", title: "添付: 失敗", since: "1.5" },
  { name: "chat/attachment-done", title: "添付: 完了", since: "1.5" },
  { name: "chat/empty-rooms", title: "チャンネルが 0 件", since: "1.5" },
  { name: "chat/empty-messages", title: "メッセージが 0 件", since: "1.5" },
  { name: "chat/public-preview", title: "public ルームを参加せずに閲覧", since: "1.5" },
  { name: "chat/removed-from-channel", title: "チャンネルにアクセスできない（外された）", since: "1.5" },
  { name: "chat/removed-from-workspace", title: "ワークスペースから削除された", since: "1.5" },
  { name: "chat/members-panel", title: "メンバーパネル", since: "1.5" },
  { name: "chat/workspace-switcher", title: "ワークスペースの切り替え", since: "1.5" },
  { name: "chat/workspace-create-dialog", title: "ワークスペースを作成", since: "1.5" },
  { name: "chat/channel-create-dialog", title: "チャンネルを作成", since: "6-1" },
  { name: "chat/dm-dialog", title: "ダイレクトメッセージを開く", since: "6-1" },
  { name: "chat/room-settings-dialog", title: "チャンネルの設定", since: "6-1" },
  { name: "chat/message-menu", title: "メッセージの操作メニュー", since: "6-1" },
  { name: "chat/message-editing", title: "メッセージの編集中", since: "6-1" },
  { name: "chat/message-delete-dialog", title: "メッセージの削除", since: "6-1" },
  { name: "chat/account-menu", title: "アカウントメニュー", since: "6-1" },
  { name: "chat/search-empty", title: "チャンネル検索の 0 件", since: "6-1" },
  { name: "chat/empty-workspaces", title: "ワークスペースが 0 件", since: "6-2" },
  { name: "chat/avatar-images", title: "画像のアバター", since: "6-1" },
  { name: "chat/system-messages", title: "参加・名前の変更のログ", since: "6.4" },
  { name: "chat/server-error", title: "サーバーに接続できない", since: "1.5" },
  { name: "chat/sidebar-add-entries", title: "サイドバーの作成・DM の入口", since: "6-2" },
  { name: "chat/room-header-settings", title: "ルームのヘッダーの設定", since: "6-2" },
  { name: "chat/member-add-dialog", title: "チャンネルにメンバーを追加", since: "6-2" },
  { name: "chat/room-settings-leave", title: "チャンネルの設定からの退出", since: "6" },
  { name: "chat/dialog-leave-room", title: "チャンネルの退出の確認（公開）", since: "6" },
  { name: "chat/dialog-leave-room-private", title: "チャンネルの退出の確認（非公開）", since: "6" },
  { name: "chat/thread-panel", title: "スレッドのパネル", since: "6.5" },
  { name: "chat/thread-panel-empty", title: "スレッドのパネル: 返信が 0 件", since: "6.5" },
  { name: "chat/thread-root-deleted", title: "スレッドのパネル: 親が削除された", since: "6.5" },
  { name: "chat/thread-broadcast", title: "チャンネルにも投稿した返信", since: "6.6" },
  { name: "chat/mentions", title: "メンション（自分宛て・@channel・@here）", since: "6.13" },
  { name: "chat/mentions-dark", title: "メンション（ダーク）", dark: true, since: "6.13" },
  { name: "chat/mention-completion", title: "メンション: @ の補完", since: "6.13" },
  { name: "chat/mention-completion-typed", title: "メンション: 名前で絞った補完", since: "6.13" },
  { name: "chat/mention-all-confirm", title: "メンション: @channel を送る前の確認", since: "6.13" },
  { name: "chat/message-link-card", title: "メッセージへのリンクのカード", since: "6.11" },
  { name: "chat/unread-jump-bar", title: "未読へ飛ぶバー", since: "6.11" },
  { name: "chat/jump-highlight", title: "飛んできた先の強調", since: "6.11" },
  { name: "chat/message-not-found", title: "リンク先のメッセージが見つからない", since: "6.11" },
  { name: "chat/reactions", title: "絵文字のリアクション", since: "6.7" },
  { name: "chat/reactions-dark", title: "絵文字のリアクション（ダーク）", dark: true, since: "6.7" },
  { name: "chat/reaction-names", title: "リアクション: 誰が付けたか", since: "6.7" },
  { name: "chat/reaction-picker", title: "リアクション: 絵文字のピッカー", since: "6.7" },
  { name: "chat/reaction-picker-dark", title: "リアクション: 絵文字のピッカー（ダーク）", dark: true, since: "6.7" },
  { name: "chat/reaction-picker-above", title: "リアクション: ピッカーが上に開く", since: "6.7" },
  { name: "chat/threads", title: "参加しているスレッドの一覧", since: "6.5" },
  { name: "chat/threads-empty", title: "参加しているスレッドが 0 件", since: "6.5" },
  { name: "chat/mobile-thread", title: "スレッド（モバイル）", mobile: true, since: "6.5" },
  { name: "chat/mobile-thread-broadcast", title: "スレッド: チャンネルにも投稿（モバイル）", mobile: true, since: "6.6" },
  { name: "chat/mobile-mentions", title: "メンション（モバイル）", mobile: true, since: "6.13" },
  { name: "chat/mobile-mention-completion", title: "メンション: @ の補完（モバイル）", mobile: true, since: "6.13" },
  { name: "chat/mobile-room-broadcast", title: "チャンネルにも投稿した返信（モバイル）", mobile: true, since: "6.6" },
  { name: "chat/mobile-unread-jump-bar", title: "未読へ飛ぶバー（モバイル）", mobile: true, since: "6.11" },
  { name: "chat/mobile-jump-highlight", title: "飛んできた先の強調（モバイル）", mobile: true, since: "6.11" },
  { name: "chat/mobile-threads", title: "参加しているスレッドの一覧（モバイル）", mobile: true, since: "6.5" },
  { name: "chat/mobile-reactions", title: "絵文字のリアクション（モバイル）", mobile: true, since: "6.7" },
  { name: "chat/mobile-reaction-picker", title: "リアクション: 絵文字のピッカー（モバイル）", mobile: true, since: "6.7" },
  { name: "chat/mobile-rooms", title: "チャンネル一覧（モバイル）", mobile: true, since: "1.5" },
  { name: "chat/mobile-room", title: "ルーム（モバイル）", mobile: true, since: "1.5" },
  { name: "chat/mobile-members-sheet", title: "メンバーシート（モバイル）", mobile: true, since: "1.5" },

  { name: "invite/accept-preview", title: "招待: プレビュー", since: "1.5" },
  { name: "invite/accept-already", title: "招待: 参加済み", since: "1.5" },
  { name: "invite/accept-invalid", title: "招待: 無効", since: "1.5" },
  { name: "invite/accept-expired", title: "招待: 期限切れ", since: "1.5" },
  { name: "invite/accept-maxed", title: "招待: 使用上限", since: "1.5" },

  { name: "workspace/settings-as-owner", title: "設定（オーナー）", since: "1.5" },
  { name: "workspace/settings-as-admin", title: "設定（管理者）", since: "1.5" },
  { name: "workspace/settings-as-member", title: "設定（メンバー）", since: "1.5" },
  { name: "workspace/members-as-owner", title: "メンバー（オーナー）", since: "1.5" },
  { name: "workspace/members-as-admin", title: "メンバー（管理者）", since: "1.5" },
  { name: "workspace/members-as-member", title: "メンバー（メンバー）", since: "1.5" },
  { name: "workspace/members-dark", title: "メンバー（ダーク）", dark: true, since: "1.5" },
  { name: "workspace/mobile-members", title: "メンバー（モバイル）", mobile: true, since: "1.5" },
  { name: "workspace/member-menu-role-picker", title: "ロールの選択", since: "1.5" },
  { name: "workspace/member-menu-locked-reason", title: "管理できない理由", since: "1.5" },
  { name: "workspace/member-menu-with-kick", title: "ロールの選択とキック", since: "6-1" },
  { name: "workspace/dialog-kick", title: "キックの確認", since: "1.5" },
  { name: "workspace/dialog-transfer-pick", title: "譲渡先の選択", since: "1.5" },
  { name: "workspace/dialog-transfer-confirm", title: "譲渡の確認", since: "1.5" },
  { name: "workspace/dialog-leave", title: "退出の確認", since: "6" },
  { name: "workspace/dialog-leave-blocked-owner", title: "オーナーは退出できない", since: "1.5" },
  { name: "workspace/back-to-chat", title: "管理画面からチャットに戻る", since: "6-2" },
  { name: "workspace/invites-as-owner", title: "招待リンク（オーナー）", since: "1.5" },
  { name: "workspace/invites-as-admin", title: "招待リンク（管理者）", since: "1.5" },
  { name: "workspace/invites-as-member", title: "招待リンク（メンバー）", since: "1.5" },
  { name: "workspace/invites-as-member-policy-all", title: "招待リンク（メンバー・全員が作成可）", since: "1.5" },
  { name: "workspace/dialog-invite-new", title: "招待リンクを作成", since: "1.5" },
  { name: "workspace/dialog-invite-created", title: "招待リンクを作成済み", since: "1.5" },

  { name: "settings/profile", title: "プロフィール", since: "1.5" },
  { name: "settings/devices", title: "ログイン中のデバイス", since: "1.5" },
  { name: "settings/devices-dark", title: "ログイン中のデバイス（ダーク）", dark: true, since: "1.5" },
  { name: "settings/profile-avatar", title: "プロフィール: 画像あり", since: "6-1" },
  { name: "settings/profile-avatar-uploading", title: "プロフィール: アップロード中", since: "6-1" },
  { name: "settings/profile-avatar-failed", title: "プロフィール: アップロード失敗", since: "6-1" },
  { name: "settings/appearance", title: "外観", since: "1.5" },
  { name: "settings/back-to-chat", title: "設定からチャットに戻る", since: "6-2" },
  { name: "settings/mobile-list", title: "設定の一覧（モバイル）", mobile: true, since: "1.5" },
  { name: "settings/mobile-back-to-chat", title: "設定からチャットに戻る（モバイル）", mobile: true, since: "6-2" },
];

export function findPreviewEntry(name: string): PreviewEntry | undefined {
  return previewCatalog.find((entry) => entry.name === name);
}

export function previewGroupOf(entry: PreviewEntry): PreviewGroup {
  return entry.name.split("/")[0] as PreviewGroup;
}

/**
 * 一覧の絞り込み。名前（`chat/reactions`）と表示名の両方を、大文字小文字を無視した部分一致で見る。
 * 空白で区切った語は AND にする（「reaction dark」で絞れるように）。
 */
export function filterPreviewCatalog(
  entries: PreviewEntry[],
  query: string,
  since: PreviewSince | "all" = "all",
): PreviewEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter((entry) => {
    if (since !== "all" && entry.since !== since) return false;
    const haystack = `${entry.name} ${entry.title}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}
