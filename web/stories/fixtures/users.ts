import type { ProfileView, UserRef, UserStatusView } from "@/components/chat/types";
import type { DeviceView } from "@/components/settings/devices-settings";

/**
 * story に使うユーザーとアバター、プロフィールとステータス（ADR 0049 / 0050）。
 */
/**
 * story のモックのアバター画像（public/dev/。Storybook は staticDirs で配る）。
 * 本物は署名付き URL（ADR 0020）で、ここでは静的なファイルで代用する。
 */
export const mockAvatars = {
  you: "/dev/avatar-1.png",
  miyuki: "/dev/avatar-2.png",
  naoki: "/dev/avatar-3.png",
} as const;

export const users = {
  you: { id: "01J8ZH5K000000000000000001", name: "あなた", handle: "you" },
  naoki: { id: "01J8ZH5K000000000000000002", name: "佐藤 直樹", handle: "naoki" },
  miyuki: { id: "01J8ZH5K000000000000000005", name: "高橋 みゆき", handle: "miyuki" },
  ryo: { id: "01J8ZH5K000000000000000008", name: "中村 涼", handle: "nakamura" },
  misaki: { id: "01J8ZH5K000000000000000009", name: "田中 美咲", handle: "misaki" },
  suzuki: { id: "01J8ZH5K00000000000000000B", name: "鈴木 涼", handle: "ryo" },
  haru: { id: "01J8ZH5K00000000000000000G", name: "小林 陽向", handle: "haru" },
  kei: { id: "01J8ZH5K00000000000000000H", name: "森田 圭", handle: "kei" },
} as const;

export const currentUser: UserRef = users.you;

export const you = { id: users.you.id, name: users.you.name };

export const naoki = { id: users.naoki.id, name: users.naoki.name };

export const miyuki = { id: users.miyuki.id, name: users.miyuki.name };

export const ryo = { id: users.ryo.id, name: users.ryo.name };

// ---- 離席とカスタムステータス（ADR 0049。chat/presence/） ----

/** 自分のステータス。アカウントメニューと設定のダイアログに出す。 */
export const myStatus: UserStatusView = { emoji: "🍵", text: "休憩中", expiresLabel: "今日 17:00 まで" };

/** 誰がどのステータスを出しているか。名前の横・メンバーパネル・サイドバーの DM で同じ表を使う。 */
export const statuses: Readonly<Record<string, UserStatusView>> = {
  [users.naoki.id]: { emoji: "📅", text: "会議中", expiresLabel: "11:30 まで" },
  [users.miyuki.id]: { emoji: "🎧", text: "集中しています" },
  [users.ryo.id]: { emoji: "🌴", text: "休暇中" },
};

export const devices: DeviceView[] = [
  { id: "s-1", kind: "browser", name: "Chrome · macOS", lastActiveLabel: "現在アクティブ", current: true },
  { id: "s-2", kind: "phone", name: "hibari for iOS · iPhone 15", lastActiveLabel: "2分前", current: false },
  { id: "s-3", kind: "desktop", name: "hibari for macOS · MacBook Air", lastActiveLabel: "昨日 18:24", current: false },
  { id: "s-4", kind: "browser", name: "Safari · iPadOS", lastActiveLabel: "3日前", current: false },
  { id: "s-5", kind: "desktop", name: "Firefox · Windows 11", lastActiveLabel: "9月2日", current: false },
];

// ---- プロフィールのカード（Phase 6.9。ADR 0050） ----

/** ホバーのカードを出すメッセージ。どれもアバターと名前のある先頭の行。 */
export const profileKeys = { naoki: "m-1012", ryo: "m-1030", miyuki: "m-0955", you: "m-0941", former: "m-1420" } as const;

const cardUser = (user: { id: string; name: string; handle: string }) => ({
  id: user.id,
  name: user.name,
  handle: user.handle,
  status: statuses[user.id],
});

/** カードとパネルの中身。名前・ロール・presence・ステータスはメンバーパネル（roomMembersWithPresence）とそろえる。 */
export const profiles = {
  /** 他人（オーナー）。member の自分からは管理の入口が出ない。 */
  naoki: {
    kind: "member",
    user: cardUser(users.naoki),
    presence: "online",
    role: "owner",
    email: { state: "ready", value: "naoki.sato@example.com" },
    isSelf: false,
  },
  /** 管理者の自分から見た member。ロールの変更と削除が出る。 */
  ryo: {
    kind: "member",
    user: cardUser(users.ryo),
    presence: "offline",
    role: "member",
    email: { state: "ready", value: "ryo.nakamura@example.com" },
    isSelf: false,
    manage: { grantableRoles: ["admin", "member"], canRemove: true },
  },
  /** email の応答を待っている（行の高さだけ先に取る）。 */
  miyukiLoading: {
    kind: "member",
    user: cardUser(users.miyuki),
    presence: "away",
    role: "admin",
    email: { state: "loading" },
    isSelf: false,
  },
  /** email が未検証（行もコピーも出さない。決定 2）。 */
  miyukiUnverified: {
    kind: "member",
    user: cardUser(users.miyuki),
    presence: "away",
    role: "admin",
    email: { state: "none" },
    isSelf: false,
  },
  you: {
    kind: "member",
    user: { ...cardUser(users.you), status: myStatus },
    presence: "online",
    role: "member",
    email: { state: "ready", value: "you@example.com" },
    isSelf: true,
  },
  /** 外された人。メッセージが持っている名前・handle・アバターだけ（決定 5）。 */
  former: { kind: "former", user: { id: users.kei.id, name: users.kei.name, handle: users.kei.handle } },
} satisfies Record<string, ProfileView>;
