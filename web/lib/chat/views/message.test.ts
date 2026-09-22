import { describe, expect, it } from "vitest";
import { permalinksIn, previewImageIds, toAttachmentDraftView } from "@/lib/chat/views/message";
import { message } from "@/test/chat-data";
import { LINK_MSG, LINK_ROOM, ORIGIN, PERMALINK, WS, pdf, png } from "@/test/views";

describe("previewImageIds", () => {
  it("lists the images of messages that are not deleted", () => {
    expect(
      previewImageIds([
        message(1, { attachments: [png, pdf] }),
        message(2, { attachments: [{ ...png, id: "a5" }], deleted_at: "2026-09-13T01:00:00Z" }),
        message(3, { attachments: [{ ...png, id: "a6", content_type: "image/jpeg" }] }),
      ]),
    ).toEqual(["a1", "a6"]);
  });
});

describe("toAttachmentDraftView", () => {
  const file = new File(["x".repeat(2048)], "サイドバー改訂.fig");
  const base = { key: "draft-1", file, fileName: file.name, progress: 0, attachment: null };

  it("maps each upload status", () => {
    expect(toAttachmentDraftView({ ...base, status: "uploading", progress: 62 })).toEqual({
      id: "draft-1",
      fileName: "サイドバー改訂.fig",
      status: "uploading",
      progress: 62,
    });
    expect(toAttachmentDraftView({ ...base, status: "failed" })).toEqual({
      id: "draft-1",
      fileName: "サイドバー改訂.fig",
      status: "failed",
    });
    expect(toAttachmentDraftView({ ...base, status: "uploaded", progress: 100, attachment: pdf })).toEqual({
      id: "draft-1",
      fileName: "サイドバー改訂.fig",
      status: "uploaded",
      sizeLabel: "2 KB",
    });
  });
});

describe("permalinksIn", () => {
  it("画面に出す本文からリンクを集め、重複をまとめる", () => {
    const messages = [message(1, { body: `見て ${PERMALINK}` }), message(2, { body: `これも ${PERMALINK}` })];
    expect(permalinksIn(messages, ORIGIN)).toEqual([{ workspaceId: WS, roomId: LINK_ROOM, messageId: LINK_MSG }]);
  });

  it("削除したメッセージの本文は見ない（本文が空になっている）", () => {
    const messages = [message(1, { body: "", deleted_at: "2026-09-13T02:00:00Z" })];
    expect(permalinksIn(messages, ORIGIN)).toEqual([]);
  });
});
