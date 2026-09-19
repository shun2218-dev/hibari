/**
 * /dev/preview で再現する画面の一覧。名前は docs/ui/screenshots/ の PNG のパス（拡張子なし）と 1 対 1 に対応させ、
 * どのスクリーンショットと見比べればよいかを名前だけで分かるようにする（catalog.test.ts が対応を検査する）。
 */

export type PreviewGroup = "auth" | "chat" | "invite" | "workspace" | "settings";

export type PreviewEntry = {
  name: string;
  title: string;
  /** ダークテーマで描く（名前が -dark で終わるもの）。 */
  dark?: boolean;
  /** モバイルのレイアウトで見る（ブラウザの幅を 768px 未満にする）。 */
  mobile?: boolean;
};

export const previewGroups: Record<PreviewGroup, string> = {
  auth: "認証",
  chat: "チャット",
  invite: "招待の受け入れ",
  workspace: "ワークスペースの管理",
  settings: "ユーザー設定",
};

export const previewCatalog: PreviewEntry[] = [
  { name: "auth/login", title: "ログイン" },
  { name: "auth/login-error-credentials", title: "ログイン: 認証情報の誤り" },
  { name: "auth/login-error-rate-limit", title: "ログイン: 試行回数の上限" },
  { name: "auth/login-dark", title: "ログイン（ダーク）", dark: true },
  { name: "auth/mobile-login", title: "ログイン（モバイル）", mobile: true },
  { name: "auth/signup", title: "アカウントを作成" },
  { name: "auth/forgot", title: "パスワードの再設定を依頼" },
  { name: "auth/forgot-error-rate-limit", title: "再設定メールの依頼: 回数制限" },
  { name: "auth/forgot-sent", title: "再設定メールを送信済み" },
  { name: "auth/reset", title: "新しいパスワードを設定" },
  { name: "auth/reset-error-invalid-input", title: "新しいパスワード: 入力エラー" },
  { name: "auth/reset-done", title: "パスワードを変更済み" },
  { name: "auth/reset-invalid", title: "再設定リンクが無効" },
  { name: "auth/verify-pending", title: "メール確認待ち" },
  { name: "auth/verify-checking", title: "メールを確認中" },
  { name: "auth/verify-done", title: "メール確認済み" },
  { name: "auth/verify-invalid", title: "確認リンクが無効" },

  { name: "chat/default", title: "チャット（未読・入力中）" },
  { name: "chat/default-dark", title: "チャット（ダーク）", dark: true },
  { name: "chat/messages-all-states", title: "メッセージの全状態" },
  { name: "chat/messages-all-states-dark", title: "メッセージの全状態（ダーク）", dark: true },
  { name: "chat/message-hover-actions", title: "メッセージのホバー操作" },
  { name: "chat/banner-reconnecting", title: "再接続中バナー" },
  { name: "chat/banner-syncing", title: "同期中バナー" },
  { name: "chat/banner-restored", title: "復帰バナー" },
  { name: "chat/attachment-uploading", title: "添付: アップロード中" },
  { name: "chat/attachment-failed", title: "添付: 失敗" },
  { name: "chat/attachment-done", title: "添付: 完了" },
  { name: "chat/empty-rooms", title: "チャンネルが 0 件" },
  { name: "chat/empty-messages", title: "メッセージが 0 件" },
  { name: "chat/public-preview", title: "public ルームを参加せずに閲覧" },
  { name: "chat/removed-from-channel", title: "チャンネルにアクセスできない（外された）" },
  { name: "chat/removed-from-workspace", title: "ワークスペースから削除された" },
  { name: "chat/members-panel", title: "メンバーパネル" },
  { name: "chat/workspace-switcher", title: "ワークスペースの切り替え" },
  { name: "chat/workspace-create-dialog", title: "ワークスペースを作成" },
  { name: "chat/channel-create-dialog", title: "チャンネルを作成" },
  { name: "chat/dm-dialog", title: "ダイレクトメッセージを開く" },
  { name: "chat/room-settings-dialog", title: "チャンネルの設定" },
  { name: "chat/message-menu", title: "メッセージの操作メニュー" },
  { name: "chat/message-editing", title: "メッセージの編集中" },
  { name: "chat/message-delete-dialog", title: "メッセージの削除" },
  { name: "chat/account-menu", title: "アカウントメニュー" },
  { name: "chat/search-empty", title: "チャンネル検索の 0 件" },
  { name: "chat/empty-workspaces", title: "ワークスペースが 0 件" },
  { name: "chat/avatar-images", title: "画像のアバター" },
  { name: "chat/system-messages", title: "参加・名前の変更のログ" },
  { name: "chat/server-error", title: "サーバーに接続できない" },
  { name: "chat/sidebar-add-entries", title: "サイドバーの作成・DM の入口" },
  { name: "chat/room-header-settings", title: "ルームのヘッダーの設定" },
  { name: "chat/member-add-dialog", title: "チャンネルにメンバーを追加" },
  { name: "chat/room-settings-leave", title: "チャンネルの設定からの退出" },
  { name: "chat/dialog-leave-room", title: "チャンネルの退出の確認（公開）" },
  { name: "chat/dialog-leave-room-private", title: "チャンネルの退出の確認（非公開）" },
  { name: "chat/thread-panel", title: "スレッドのパネル" },
  { name: "chat/thread-panel-empty", title: "スレッドのパネル: 返信が 0 件" },
  { name: "chat/thread-root-deleted", title: "スレッドのパネル: 親が削除された" },
  { name: "chat/thread-broadcast", title: "チャンネルにも投稿した返信" },
  { name: "chat/mentions", title: "メンション（自分宛て・@channel・@here）" },
  { name: "chat/mentions-dark", title: "メンション（ダーク）", dark: true },
  { name: "chat/mention-completion", title: "メンション: @ の補完" },
  { name: "chat/mention-completion-typed", title: "メンション: 名前で絞った補完" },
  { name: "chat/mention-all-confirm", title: "メンション: @channel を送る前の確認" },
  { name: "chat/threads", title: "参加しているスレッドの一覧" },
  { name: "chat/threads-empty", title: "参加しているスレッドが 0 件" },
  { name: "chat/mobile-thread", title: "スレッド（モバイル）", mobile: true },
  { name: "chat/mobile-thread-broadcast", title: "スレッド: チャンネルにも投稿（モバイル）", mobile: true },
  { name: "chat/mobile-mentions", title: "メンション（モバイル）", mobile: true },
  { name: "chat/mobile-mention-completion", title: "メンション: @ の補完（モバイル）", mobile: true },
  { name: "chat/mobile-room-broadcast", title: "チャンネルにも投稿した返信（モバイル）", mobile: true },
  { name: "chat/mobile-threads", title: "参加しているスレッドの一覧（モバイル）", mobile: true },
  { name: "chat/mobile-rooms", title: "チャンネル一覧（モバイル）", mobile: true },
  { name: "chat/mobile-room", title: "ルーム（モバイル）", mobile: true },
  { name: "chat/mobile-members-sheet", title: "メンバーシート（モバイル）", mobile: true },

  { name: "invite/accept-preview", title: "招待: プレビュー" },
  { name: "invite/accept-already", title: "招待: 参加済み" },
  { name: "invite/accept-invalid", title: "招待: 無効" },
  { name: "invite/accept-expired", title: "招待: 期限切れ" },
  { name: "invite/accept-maxed", title: "招待: 使用上限" },

  { name: "workspace/settings-as-owner", title: "設定（オーナー）" },
  { name: "workspace/settings-as-admin", title: "設定（管理者）" },
  { name: "workspace/settings-as-member", title: "設定（メンバー）" },
  { name: "workspace/members-as-owner", title: "メンバー（オーナー）" },
  { name: "workspace/members-as-admin", title: "メンバー（管理者）" },
  { name: "workspace/members-as-member", title: "メンバー（メンバー）" },
  { name: "workspace/members-dark", title: "メンバー（ダーク）", dark: true },
  { name: "workspace/mobile-members", title: "メンバー（モバイル）", mobile: true },
  { name: "workspace/member-menu-role-picker", title: "ロールの選択" },
  { name: "workspace/member-menu-locked-reason", title: "管理できない理由" },
  { name: "workspace/member-menu-with-kick", title: "ロールの選択とキック" },
  { name: "workspace/dialog-kick", title: "キックの確認" },
  { name: "workspace/dialog-transfer-pick", title: "譲渡先の選択" },
  { name: "workspace/dialog-transfer-confirm", title: "譲渡の確認" },
  { name: "workspace/dialog-leave", title: "退出の確認" },
  { name: "workspace/dialog-leave-blocked-owner", title: "オーナーは退出できない" },
  { name: "workspace/back-to-chat", title: "管理画面からチャットに戻る" },
  { name: "workspace/invites-as-owner", title: "招待リンク（オーナー）" },
  { name: "workspace/invites-as-admin", title: "招待リンク（管理者）" },
  { name: "workspace/invites-as-member", title: "招待リンク（メンバー）" },
  { name: "workspace/invites-as-member-policy-all", title: "招待リンク（メンバー・全員が作成可）" },
  { name: "workspace/dialog-invite-new", title: "招待リンクを作成" },
  { name: "workspace/dialog-invite-created", title: "招待リンクを作成済み" },

  { name: "settings/profile", title: "プロフィール" },
  { name: "settings/devices", title: "ログイン中のデバイス" },
  { name: "settings/devices-dark", title: "ログイン中のデバイス（ダーク）", dark: true },
  { name: "settings/profile-avatar", title: "プロフィール: 画像あり" },
  { name: "settings/profile-avatar-uploading", title: "プロフィール: アップロード中" },
  { name: "settings/profile-avatar-failed", title: "プロフィール: アップロード失敗" },
  { name: "settings/appearance", title: "外観" },
  { name: "settings/back-to-chat", title: "設定からチャットに戻る" },
  { name: "settings/mobile-list", title: "設定の一覧（モバイル）", mobile: true },
  { name: "settings/mobile-back-to-chat", title: "設定からチャットに戻る（モバイル）", mobile: true },
];

export function findPreviewEntry(name: string): PreviewEntry | undefined {
  return previewCatalog.find((entry) => entry.name === name);
}

export function previewGroupOf(entry: PreviewEntry): PreviewGroup {
  return entry.name.split("/")[0] as PreviewGroup;
}
