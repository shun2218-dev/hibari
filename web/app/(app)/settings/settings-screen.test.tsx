import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { THEME_STORAGE_KEY } from "@/lib/theme";
import { workspace } from "@/test/chat-data";
import { renderWithChat } from "@/test/render-with-chat";
import { type Handler, json, problem, testUser, tokens } from "@/test/fake-api";
import { renderWithSession } from "@/test/render-with-session";

import { AppearanceSection } from "./appearance/appearance-section";
import { DevicesSection } from "./devices/devices-section";
import { NotificationsSection } from "./notifications/notifications-section";
import { ProfileSection } from "./profile/profile-section";
import { SettingsShell } from "./settings-shell";

const nav = vi.hoisted(() => ({ router: { replace: vi.fn(), push: vi.fn() }, pathname: "/settings/profile" }));
vi.mock("next/navigation", () => ({ useRouter: () => nav.router, usePathname: () => nav.pathname }));

const sessions = [
  {
    id: "s-1",
    user_agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/141.0.0.0 Safari/537.36",
    current: true,
    started_at: "2026-09-18T00:00:00Z",
    last_used_at: "2026-09-18T02:00:00Z",
  },
  {
    id: "s-2",
    user_agent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile Safari/604.1",
    current: false,
    started_at: "2026-09-10T00:00:00Z",
    last_used_at: "2026-09-10T09:24:00Z",
  },
];

function renderSettings(section: ReactNode, routes: Record<string, Handler> = {}) {
  return renderWithSession(<SettingsShell>{section}</SettingsShell>, {
    "POST /api/v1/auth/refresh": () => tokens("at-1"),
    "GET /api/v1/users/me": () => json(200, testUser),
    ...routes,
  });
}

describe("the user settings screens", () => {
  beforeEach(() => {
    nav.router.replace.mockReset();
    nav.router.push.mockReset();
    nav.pathname = "/settings/profile";
    window.localStorage.clear();
  });

  it("puts the section in the settings frame, with the way back to the list", async () => {
    renderSettings(<ProfileSection />);

    expect(await screen.findByRole("heading", { name: "プロフィール" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "設定の一覧に戻る" })).toHaveAttribute("href", "/settings");
    expect(screen.getByRole("link", { name: "ログイン中のデバイス" })).toHaveAttribute("href", "/settings/devices");
  });

  describe("profile", () => {
    it("saves the display name when the field loses focus", async () => {
      const user = userEvent.setup();
      const { api } = renderSettings(<ProfileSection />, {
        "PATCH /api/v1/users/me": (_url, init) => json(200, { ...testUser, ...JSON.parse(init.body as string) }),
      });

      const field = await screen.findByLabelText("表示名");
      await user.clear(field);
      await user.type(field, "佐藤 直樹 2");
      await user.tab();

      await waitFor(() => expect(api.calls.at(-1)?.init.body).toBe(JSON.stringify({ display_name: "佐藤 直樹 2" })));
      await waitFor(() => expect(screen.getByLabelText("表示名")).toHaveValue("佐藤 直樹 2"));
    });

    it("puts the handle back when it is already taken", async () => {
      const user = userEvent.setup();
      renderSettings(<ProfileSection />, { "PATCH /api/v1/users/me": () => problem(409, "handle-taken") });

      const field = await screen.findByLabelText("ハンドル");
      await user.type(field, "x");
      await user.tab();

      await waitFor(() => expect(screen.getByLabelText("ハンドル")).toHaveValue("@naoki"));
    });

    it("uploads a picked image straight to the storage, then completes it", async () => {
      const user = userEvent.setup();
      const put = vi.fn(async () => new Response(null, { status: 200 }));
      vi.stubGlobal("XMLHttpRequest", fakeXhr(put));
      const { api } = renderSettings(<ProfileSection />, {
        "POST /api/v1/users/me/avatar": () =>
          json(201, {
            upload_id: "up-1",
            upload: {
              method: "PUT",
              url: "http://storage.test/avatars/me",
              headers: { "Content-Type": "image/png" },
              expires_at: "2026-09-18T12:00:00Z",
            },
          }),
        "POST /api/v1/users/me/avatar/complete": () =>
          json(200, { ...testUser, avatar_url: "http://storage.test/avatars/me?sig=1" }),
      });

      await screen.findByLabelText("表示名");
      await user.upload(screen.getByTestId("avatar-file"), new File(["x"], "me.png", { type: "image/png" }));

      await waitFor(() => expect(api.paths()).toContain("POST /api/v1/users/me/avatar/complete"));
      expect(put).toHaveBeenCalledWith("http://storage.test/avatars/me");
      expect(api.calls.at(-1)?.init.body).toBe(
        JSON.stringify({ upload_id: "up-1", content_type: "image/png", size_bytes: 1 }),
      );
      await waitFor(() => expect(screen.getByRole("button", { name: "削除" })).toBeInTheDocument());
      vi.unstubAllGlobals();
    });

    it("offers a retry when the upload fails", async () => {
      const user = userEvent.setup();
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      renderSettings(<ProfileSection />, { "POST /api/v1/users/me/avatar": () => problem(422, "validation-error") });

      await screen.findByLabelText("表示名");
      await user.upload(screen.getByTestId("avatar-file"), new File(["x"], "me.png", { type: "image/png" }));

      expect(await screen.findByText("画像をアップロードできませんでした")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "再試行" })).toBeInTheDocument();
      error.mockRestore();
    });
  });

  describe("devices", () => {
    beforeEach(() => {
      nav.pathname = "/settings/devices";
    });

    it("names each device and marks the one in use", async () => {
      renderSettings(<DevicesSection />, { "GET /api/v1/auth/sessions": () => json(200, { sessions }) });

      expect(await screen.findByText("Chrome · macOS")).toBeInTheDocument();
      expect(screen.getByText("Safari · iOS")).toBeInTheDocument();
      expect(screen.getByText("現在アクティブ")).toBeInTheDocument();
    });

    it("logs out one device, and all the others", async () => {
      const user = userEvent.setup();
      const { api } = renderSettings(<DevicesSection />, {
        "GET /api/v1/auth/sessions": () => json(200, { sessions }),
        "DELETE /api/v1/auth/sessions/s-2": () => new Response(null, { status: 204 }),
        "DELETE /api/v1/auth/sessions": () => json(200, { revoked_count: 1 }),
      });

      await screen.findByText("Safari · iOS");
      await user.click(screen.getByRole("button", { name: "ログアウト" }));

      await waitFor(() => expect(api.paths()).toContain("DELETE /api/v1/auth/sessions/s-2"));
      await waitFor(() => expect(screen.queryByText("Safari · iOS")).not.toBeInTheDocument());
      // このデバイスは残る（「他のすべて」を押しても自分は切らない。ADR 0019）
      expect(screen.getByText("Chrome · macOS")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "他のすべてのデバイスからログアウト" }));
      await waitFor(() => expect(api.paths()).toContain("DELETE /api/v1/auth/sessions"));
      expect(screen.getByText("Chrome · macOS")).toBeInTheDocument();
    });
  });

  describe("notifications（ADR 0055）", () => {
    beforeEach(() => {
      nav.pathname = "/settings/notifications";
    });

    it("ワークスペースごとに通知する内容を選び、選んだらすぐ保存する", async () => {
      let sent: unknown;
      renderWithChat(<SettingsShell><NotificationsSection /></SettingsShell>, {
        "GET /api/v1/workspaces": () => json(200, { workspaces: [workspace("ws-1", "hibari 開発"), workspace("ws-2", "個人メモ")] }),
        "GET /api/v1/workspaces/ws-1/me/notifications": () => json(200, { level: "mentions" }),
        "GET /api/v1/workspaces/ws-2/me/notifications": () => json(200, { level: "all" }),
        "PUT /api/v1/workspaces/ws-2/me/notifications": (_url, init) => {
          sent = JSON.parse(init.body as string);
          return json(200, sent);
        },
      });

      const memo = within(await screen.findByRole("group", { name: "個人メモ" }));
      expect(within(screen.getByRole("group", { name: "hibari 開発" })).getByRole("radio", { name: /メンションと DM/ })).toBeChecked();
      expect(memo.getByRole("radio", { name: /すべて/ })).toBeChecked();
      expect(screen.getByRole("heading", { name: "通知" })).toBeInTheDocument();

      await userEvent.click(memo.getByRole("radio", { name: /なし/ }));

      await waitFor(() => expect(sent).toEqual({ level: "none" }));
      expect(memo.getByRole("radio", { name: /なし/ })).toBeChecked();
    });

    it("保存できなかったら元の値に戻す", async () => {
      renderWithChat(<SettingsShell><NotificationsSection /></SettingsShell>, {
        "GET /api/v1/workspaces": () => json(200, { workspaces: [workspace("ws-1", "hibari 開発")] }),
        "GET /api/v1/workspaces/ws-1/me/notifications": () => json(200, { level: "mentions" }),
        "PUT /api/v1/workspaces/ws-1/me/notifications": () => problem(500, "internal"),
      });
      const error = vi.spyOn(console, "error").mockImplementation(() => {});

      await userEvent.click(await screen.findByRole("radio", { name: /すべて/ }));

      await waitFor(() => expect(screen.getByRole("radio", { name: /メンションと DM/ })).toBeChecked());
      expect(error).toHaveBeenCalled();
    });
  });

  describe("appearance", () => {
    beforeEach(() => {
      nav.pathname = "/settings/appearance";
    });

    it("remembers the theme on this device and applies it right away", async () => {
      const user = userEvent.setup();
      renderSettings(<AppearanceSection />);

      await user.click(await screen.findByRole("radio", { name: /ダーク/ }));

      expect(document.documentElement.dataset.theme).toBe("dark");
      expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");

      await user.click(screen.getByRole("radio", { name: /ライト/ }));
      expect(document.documentElement.dataset.theme).toBe("light");
    });

    it("shows the density but does not let it be changed (no design for the values)", async () => {
      renderSettings(<AppearanceSection />);

      expect(await screen.findByRole("radio", { name: /詰める/ })).toBeDisabled();
    });
  });
});

/** 署名付き URL への PUT（lib/chat/put-file.ts が使う XMLHttpRequest）の代わり。 */
function fakeXhr(put: (url: string) => Promise<Response>) {
  return class {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    status = 200;
    upload = { onprogress: null as ((e: ProgressEvent) => void) | null };
    #url = "";
    open(_method: string, url: string) {
      this.#url = url;
    }
    setRequestHeader() {}
    send() {
      void put(this.#url).then((res) => {
        this.status = res.status;
        this.onload?.();
      });
    }
    abort() {
      this.onabort?.();
    }
  };
}
