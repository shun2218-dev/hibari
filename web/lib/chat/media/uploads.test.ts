import { afterEach, describe, expect, it, vi } from "vitest";

import { type Attachment, type CreateAttachmentRequest, PROBLEM_TYPE_PREFIX } from "@/lib/api/types.gen";
import { createSession } from "@/lib/auth/session/session";
import { type Handler, TEST_API_BASE, fakeApi, json, tokens } from "@/test/fake-api";

import { createChatApi } from "@/lib/chat/api/chat-api";
import { type PutFile, UploadAbortedError } from "./put-file";
import {
  MAX_ATTACHMENTS,
  createAttachmentUploader,
  draftsReady,
  uploadContentType,
  uploadFileName,
} from "./uploads";

function attachmentOf(id: string, req: CreateAttachmentRequest, status: Attachment["status"]): Attachment {
  return {
    id,
    room_id: "r1",
    status,
    file_name: req.file_name,
    content_type: req.content_type,
    size_bytes: req.size_bytes ?? 0,
    width: req.width ?? null,
    height: req.height ?? null,
    created_at: "2026-09-17T00:00:00Z",
  };
}

/** 発行と complete を覚えておく偽の API。ストレージへの PUT は putFile で差し替える。 */
function setup({ routes = {}, putFile }: { routes?: Record<string, Handler>; putFile?: PutFile } = {}) {
  const created: CreateAttachmentRequest[] = [];
  const byId = new Map<string, CreateAttachmentRequest>();
  const api = fakeApi({
    "POST /api/v1/auth/refresh": () => tokens("at-1"),
    "POST /api/v1/rooms/r1/attachments": (_url, init) => {
      const req = JSON.parse(init.body as string) as CreateAttachmentRequest;
      created.push(req);
      const id = `att-${created.length}`;
      byId.set(id, req);
      return json(201, {
        attachment: attachmentOf(id, req, "pending"),
        upload: { method: "PUT", url: `https://storage.test/${id}?sig=x`, headers: { "Content-Type": req.content_type } },
      });
    },
    ...Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => [
        `POST /api/v1/attachments/att-${i + 1}/complete`,
        () => json(200, attachmentOf(`att-${i + 1}`, byId.get(`att-${i + 1}`)!, "uploaded")),
      ]),
    ),
    ...routes,
  });
  const session = createSession({ baseUrl: TEST_API_BASE, fetch: api.fetch });
  const puts: { url: string; headers: Record<string, string> }[] = [];
  const uploader = createAttachmentUploader(createChatApi(session.request), "r1", {
    putFile:
      putFile ??
      (async (url, headers, _file, { onProgress }) => {
        puts.push({ url, headers });
        onProgress(1);
      }),
    imageSize: async () => ({ width: 1280, height: 800 }),
  });
  return { api, uploader, created, puts };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createAttachmentUploader", () => {
  it("creates, puts and completes each file, declaring the size of images", async () => {
    const { uploader, created, puts, api } = setup();
    const image = new File(["png"], "mock.png", { type: "image/png" });
    const fig = new File(["figma"], "サイドバー改訂.fig");

    uploader.add([image, fig]);

    expect(uploader.getSnapshot()).toMatchObject([
      { fileName: "mock.png", status: "uploading", progress: 0 },
      { fileName: "サイドバー改訂.fig", status: "uploading", progress: 0 },
    ]);
    await vi.waitFor(() => expect(draftsReady(uploader.getSnapshot())).toBe(true));

    // 画像は寸法を読んでから発行するので、発行の順は選んだ順とは限らない。並びは選んだ順のまま
    expect(created).toHaveLength(2);
    expect(created).toEqual(
      expect.arrayContaining([
        { file_name: "mock.png", content_type: "image/png", size_bytes: 3, width: 1280, height: 800 },
        { file_name: "サイドバー改訂.fig", content_type: "application/octet-stream", size_bytes: 5 },
      ]),
    );
    expect(puts.map((p) => p.headers["Content-Type"]).sort()).toEqual(["application/octet-stream", "image/png"]);
    expect(api.paths().filter((p) => p.endsWith("/complete"))).toHaveLength(2);
    expect(uploader.getSnapshot()).toMatchObject([
      { status: "uploaded", progress: 100, attachment: { file_name: "mock.png", width: 1280, height: 800 } },
      { status: "uploaded", attachment: { file_name: "サイドバー改訂.fig", content_type: "application/octet-stream" } },
    ]);

    expect(uploader.take().map((a) => a.file_name)).toEqual(["mock.png", "サイドバー改訂.fig"]);
    expect(uploader.getSnapshot()).toEqual([]);
  });

  it("reports the progress of the put", async () => {
    let report!: (ratio: number) => void;
    let finish!: () => void;
    const { uploader } = setup({
      putFile: (_url, _headers, _file, { onProgress }) =>
        new Promise((resolve) => {
          report = onProgress;
          finish = resolve;
        }),
    });

    uploader.add([new File(["x"], "a.txt", { type: "text/plain" })]);
    await vi.waitFor(() => expect(report).toBeDefined());
    report(0.624);

    expect(uploader.getSnapshot()[0]).toMatchObject({ status: "uploading", progress: 62 });
    finish();
    await vi.waitFor(() => expect(uploader.getSnapshot()[0]?.status).toBe("uploaded"));
  });

  it("marks a failed upload and starts over from a new url on retry", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let fail = true;
    const { uploader, created } = setup({
      putFile: async () => {
        if (fail) throw new Error("upload responded 403");
      },
    });

    uploader.add([new File(["x"], "a.txt", { type: "text/plain" })]);
    await vi.waitFor(() => expect(uploader.getSnapshot()[0]?.status).toBe("failed"));
    expect(draftsReady(uploader.getSnapshot())).toBe(false);

    fail = false;
    uploader.retry(uploader.getSnapshot()[0]!.key);
    expect(uploader.getSnapshot()[0]).toMatchObject({ status: "uploading", progress: 0 });
    await vi.waitFor(() => expect(uploader.getSnapshot()[0]).toMatchObject({ status: "uploaded", attachment: { id: "att-2" } }));
    expect(created).toHaveLength(2);
  });

  it("aborts the put and ignores its result when the file is removed", async () => {
    let signal!: AbortSignal;
    const { uploader, api } = setup({
      putFile: (_url, _headers, _file, options) =>
        new Promise((_resolve, reject) => {
          signal = options.signal;
          signal.addEventListener("abort", () => reject(new UploadAbortedError()));
        }),
    });

    uploader.add([new File(["x"], "a.txt", { type: "text/plain" })]);
    await vi.waitFor(() => expect(signal).toBeDefined());
    uploader.remove(uploader.getSnapshot()[0]!.key);

    expect(signal.aborted).toBe(true);
    expect(uploader.getSnapshot()).toEqual([]);
    await Promise.resolve();
    expect(api.paths().some((p) => p.endsWith("/complete"))).toBe(false);
  });

  it("aborts everything when the room is left", async () => {
    const signals: AbortSignal[] = [];
    const { uploader } = setup({
      putFile: (_url, _headers, _file, { signal }) => {
        signals.push(signal);
        return new Promise(() => {});
      },
    });

    uploader.add([new File(["a"], "a.txt"), new File(["b"], "b.txt")]);
    await vi.waitFor(() => expect(signals).toHaveLength(2));
    uploader.abortAll();

    expect(signals.every((s) => s.aborted)).toBe(true);
    expect(uploader.getSnapshot()).toEqual([]);
  });

  it("falls back to application/octet-stream when the server does not allow the declared type", async () => {
    const { uploader, created } = setup({
      routes: {
        "POST /api/v1/rooms/r1/attachments": (_url, init) => {
          const req = JSON.parse(init.body as string) as CreateAttachmentRequest;
          created.push(req);
          if (req.content_type !== "application/octet-stream") {
            return new Response(
              JSON.stringify({
                type: `${PROBLEM_TYPE_PREFIX}validation-error`,
                title: "x",
                status: 422,
                errors: [{ field: "content_type", reason: "invalid_value" }],
              }),
              { status: 422, headers: { "Content-Type": "application/problem+json" } },
            );
          }
          return json(201, {
            attachment: attachmentOf("att-1", req, "pending"),
            upload: { method: "PUT", url: "https://storage.test/att-1", headers: {} },
          });
        },
        "POST /api/v1/attachments/att-1/complete": () =>
          json(200, attachmentOf("att-1", { ...created[1]!, content_type: "application/octet-stream" }, "uploaded")),
      },
    });

    uploader.add([new File(["x"], "report.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })]);

    await vi.waitFor(() => expect(uploader.getSnapshot()[0]?.status).toBe("uploaded"));
    expect(created.map((r) => r.content_type)).toEqual([
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/octet-stream",
    ]);
  });

  it("does not add more than ten files", () => {
    const { uploader } = setup({ putFile: () => new Promise(() => {}) });
    const files = Array.from({ length: 12 }, (_, i) => new File(["x"], `f${i}.txt`));

    uploader.add(files.slice(0, 4));
    uploader.add(files.slice(4));

    expect(uploader.getSnapshot().map((d) => d.fileName)).toEqual(files.slice(0, MAX_ATTACHMENTS).map((f) => f.name));
  });
});

describe("uploadFileName", () => {
  it("replaces characters the server rejects and keeps 255 characters", () => {
    expect(uploadFileName("a\\bc.txt")).toBe("a_b_c_.txt");
    expect(Array.from(uploadFileName("あ".repeat(300)))).toHaveLength(255);
    expect(uploadFileName("サイドバー改訂.fig")).toBe("サイドバー改訂.fig");
  });
});

describe("uploadContentType", () => {
  it("uses the browser's type only when it is a plain media type", () => {
    expect(uploadContentType(new File([], "a.png", { type: "image/png" }))).toBe("image/png");
    expect(uploadContentType(new File([], "a.fig"))).toBe("application/octet-stream");
    expect(uploadContentType(new File([], "a.txt", { type: "text/plain;charset=utf-8" }))).toBe("application/octet-stream");
  });
});
