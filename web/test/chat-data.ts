import type { Invite, Member, Message, Room, RoomMember, UserProfile, Workspace } from "@/lib/api/types.gen";

/** lib/chat とチャットのページのテストで使う API のレスポンスの組み立て。 */

export const naoki: UserProfile = { id: "01J8ZK3X5R8Q2W4E6T8Y0U2I4O", handle: "naoki", display_name: "佐藤 直樹" };
export const miyuki: UserProfile = { id: "01J8ZK3X5R8Q2W4E6T8Y0U2I5A", handle: "miyuki", display_name: "高橋 みゆき" };
export const kei: UserProfile = { id: "01J8ZK3X5R8Q2W4E6T8Y0U2I5B", handle: "kei", display_name: "森田 圭" };

export function workspace(id: string, name: string, overrides: Partial<Workspace> = {}): Workspace {
  return {
    id,
    slug: `slug-${id}`,
    name,
    invite_policy: "admins_only",
    my_role: "member",
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

export function room(id: string, name: string, overrides: Partial<Room> = {}): Room {
  return {
    id,
    workspace_id: "ws-1",
    kind: "public",
    name,
    is_default: false,
    is_member: true,
    last_message_seq: 0,
    last_message_at: null,
    last_read_seq: 0,
    last_user_seq: 0,
    last_read_user_seq: 0,
    unread_count: 0,
    last_message: null,
    created_at: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

export function message(seq: number, overrides: Partial<Message> = {}): Message {
  return {
    id: `m-${seq}`,
    room_id: "room-1",
    seq,
    change_seq: seq,
    user_seq: seq,
    kind: "user",
    sender: miyuki,
    client_msg_id: `c-${seq}`,
    body: `本文 ${seq}`,
    thread_root_id: null,
    thread_seq: null,
    also_in_channel: false,
    thread: null,
    attachments: [],
    created_at: "2026-09-13T01:00:00Z",
    edited_at: null,
    deleted_at: null,
    ...overrides,
  };
}

/** システムメッセージ（参加や名前の変更のログ。ADR 0033）。user_seq は直前の人の発言の番号のまま。 */
export function systemMessage(seq: number, system: Message["system"], overrides: Partial<Message> = {}): Message {
  return message(seq, { kind: "system", system, body: "", user_seq: seq - 1, ...overrides });
}

export function roomMember(user: UserProfile, overrides: Partial<RoomMember> = {}): RoomMember {
  return { user, role: "member", joined_at: "2026-09-01T00:00:00Z", online: false, ...overrides };
}

/** ワークスペースのメンバー（管理画面）。形はルームのメンバーと同じ。 */
export function member(user: UserProfile, overrides: Partial<Member> = {}): Member {
  return { user, role: "member", joined_at: "2026-09-01T00:00:00Z", online: false, ...overrides };
}

export function invite(id: string, overrides: Partial<Invite> = {}): Invite {
  return {
    id,
    workspace_id: "ws-1",
    created_by: miyuki,
    max_uses: 10,
    use_count: 3,
    expires_at: "2026-09-20T09:00:00Z",
    revoked_at: null,
    created_at: "2026-09-13T00:00:00Z",
    status: "active",
    ...overrides,
  };
}
