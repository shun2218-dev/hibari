import { describe, expect, it } from "vitest";
import { linkPreviewRefs, permalinksIn, previewImageIds, toAttachmentDraftView, toLinkPreviewViews } from "@/lib/chat/views/message";
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

describe("リンクのプレビュー（ADR 0065）", () => {
  const preview = {
    id: "lp-1",
    url: "https://a.example/",
    site_name: "A",
    title: "タイトル",
    description: "",
    image: { width: 1200, height: 630 },
    has_icon: true,
  };

  it("画像かアイコンのあるプレビューだけ URL を取る。削除したメッセージは取らない", () => {
    const textOnly = { ...preview, id: "lp-2", image: null, has_icon: false };
    const messages = [
      message(1, { room_id: "r1", link_previews: [preview, textOnly] }),
      message(2, { room_id: "r1", link_previews: [{ ...preview, id: "lp-3" }], deleted_at: "2026-09-13T02:00:00Z" }),
    ];
    expect(linkPreviewRefs(messages)).toEqual([{ roomId: "r1", messageId: "m-1", previewId: "lp-1" }]);
  });

  it("URL が取れるまでは画像の枠だけ、取れたら URL を入れる。空の文字列の項目は持たない", () => {
    expect(toLinkPreviewViews([preview], {})).toEqual([
      { id: "lp-1", url: "https://a.example/", siteName: "A", title: "タイトル", image: { width: 1200, height: 630, url: undefined }, hasIcon: true },
    ]);
    expect(toLinkPreviewViews([preview], { "lp-1": { image: "https://s/i", icon: "https://s/c" } })).toEqual([
      {
        id: "lp-1",
        url: "https://a.example/",
        siteName: "A",
        title: "タイトル",
        image: { width: 1200, height: 630, url: "https://s/i" },
        hasIcon: true,
        iconUrl: "https://s/c",
      },
    ]);
  });
});
