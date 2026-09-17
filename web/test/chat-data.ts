import type { Message, Room, RoomMember, UserProfile, Workspace } from "@/lib/api/types.gen";

/** lib/chat とチャットのページのテストで使う API のレスポンスの組み立て。 */

export const naoki: UserProfile = { id: "01J8ZK3X5R8Q2W4E6T8Y0U2I4O", handle: "naoki", display_name: "佐藤 直樹" };
export const miyuki: UserProfile = { id: "01J8ZK3X5R8Q2W4E6T8Y0U2I5A", handle: "miyuki", display_name: "高橋 みゆき" };

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
    sender: miyuki,
    client_msg_id: `c-${seq}`,
    body: `本文 ${seq}`,
    reply_to: null,
    attachments: [],
    created_at: "2026-09-13T01:00:00Z",
    edited_at: null,
    deleted_at: null,
    ...overrides,
  };
}

export function roomMember(user: UserProfile, overrides: Partial<RoomMember> = {}): RoomMember {
  return { user, role: "member", joined_at: "2026-09-01T00:00:00Z", online: false, ...overrides };
}
