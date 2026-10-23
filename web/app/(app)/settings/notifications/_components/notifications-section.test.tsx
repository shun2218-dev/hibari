import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useMemo } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useChatContext } from "@/hooks/chat/use-chat-context";
import type { PushSubscriptionItem } from "@/lib/api/types.gen";
import type { BrowserPushState, WebPush } from "@/lib/chat/notifications/web-push";
import { ChatContext } from "@/providers/chat-provider";
import { workspace } from "@/test/chat-data";
import { json } from "@/test/fake-api";
import { renderWithChat } from "@/test/render-with-chat";

import { NotificationsSection } from "./notifications-section";

const chromeMac =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const safariIphone =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const edgeWindows =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0";

/** story（settings-notifications--notifications-push）と同じ 3 つ。いまの端末と、ほかに 2 つ。 */
const devices: PushSubscriptionItem[] = [
  { id: "push-mac", user_agent: chromeMac, is_current: true, created_at: "2026-10-19T01:00:00Z" },
  { id: "push-iphone", user_agent: safariIphone, is_current: false, created_at: "2026-10-19T02:00:00Z" },
  { id: "push-windows", user_agent: edgeWindows, is_current: false, created_at: "2026-10-12T02:00:00Z" },
];

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void };

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * データ層（web-push.ts）の偽物。state は current を返し、enable / disable は既定ではすぐに終わって current を変える。
 * 途中の状態を見るテストは mockImplementation で止める。
 */
function fakePush(initial: BrowserPushState, list: PushSubscriptionItem[] = []) {
  let on = initial === "on";
  const listeners = new Set<() => void>();
  const fake = {
    current: initial,
    list,
    setEnabled(next: boolean) {
      on = next;
      fake.current = next ? "on" : fake.current === "on" ? "off" : fake.current;
      for (const listener of listeners) listener();
    },
  };
  const push = {
    state: vi.fn(async () => fake.current),
    enable: vi.fn(async (): Promise<BrowserPushState> => {
      fake.setEnabled(true);
      return "on";
    }),
    disable: vi.fn(async () => fake.setEnabled(false)),
    resync: vi.fn(async () => {}),
    listDevices: vi.fn(async () => ({ subscriptions: fake.list })),
    stopDevice: vi.fn(async (id: string) => {
      fake.list = fake.list.filter((d) => d.id !== id);
    }),
    enabled: () => on,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } satisfies WebPush;
  return { push, fake };
}

/** ChatProvider の値のうち push だけを差し替える（偽のソケットで描くテストでは push が null のため）。 */
function WithPush({ push, children }: { push: WebPush | null; children: ReactNode }) {
  const context = useChatContext();
  const value = useMemo(() => ({ ...context, push }), [context, push]);
  return <ChatContext value={value}>{children}</ChatContext>;
}

function renderSection(push: WebPush | null) {
  return renderWithChat(
    <WithPush push={push}>
      <NotificationsSection />
    </WithPush>,
    {
      "GET /api/v1/workspaces": () => json(200, { workspaces: [workspace("ws-1", "hibari 開発")] }),
      "GET /api/v1/workspaces/ws-1/me/notifications": () => json(200, { level: "mentions" }),
    },
  );
}

async function pushCard() {
  // ワークスペースの節が出たら、このブラウザの節も揃っている
  await screen.findByRole("group", { name: "hibari 開発" });
  return within(screen.getByRole("group", { name: "このブラウザ" }));
}

describe("設定の「通知」のプッシュ通知（ADR 0069）", () => {
  let error: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    error = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    error.mockRestore();
  });

  describe("状態ごとの表示（settings-notifications の story と同じ）", () => {
    it.each([
      ["on", /有効です。hibari を閉じていても/, { checked: true, disabled: false }],
      ["off", /オフです。有効にすると/, { checked: false, disabled: false }],
      ["denied", /アドレスバーの左のアイコンから/, null],
      ["unsupported", /このブラウザはプッシュ通知に対応していません/, null],
      ["install", /ホーム画面に追加すると通知を受け取れます/, null],
    ] as const)("%s", async (state, text, toggle) => {
      renderSection(fakePush(state).push);

      const card = await pushCard();
      // 見出し（スイッチの読み上げの名前にも同じ文言がある）
      expect(card.getAllByText("プッシュ通知")[0]).toBeInTheDocument();
      expect(card.getByText(text)).toBeInTheDocument();
      expect(card.queryByText("デスクトップ通知")).not.toBeInTheDocument();
      const control = card.queryByRole("switch", { name: "プッシュ通知" });
      if (toggle) {
        expect(control).toHaveAttribute("aria-checked", String(toggle.checked));
        expect(control).toBeEnabled();
      } else {
        // 押しても何も起きない状態ではスイッチを出さない
        expect(control).not.toBeInTheDocument();
      }
      // 通知音はタブの通知だけに効く（決定 2）
      expect(card.getByText(/タブの通知を出すときに短い音を鳴らす/)).toBeInTheDocument();
    });

    it("サーバーがプッシュを使えなければ、6.14b のデスクトップ通知のカードのまま（決定 9）", async () => {
      const { push } = fakePush("server-disabled", devices);
      renderSection(push);

      const card = await pushCard();
      expect(card.getByText("デスクトップ通知")).toBeInTheDocument();
      expect(card.queryByRole("switch")).not.toBeInTheDocument();
      expect(screen.queryByRole("group", { name: "通知を受け取る端末" })).not.toBeInTheDocument();
    });

    it("設定を読めなかったら、使えないときと同じ表示にする（失敗の画面はデザインにない）", async () => {
      const { push } = fakePush("off");
      push.state.mockRejectedValue(new Error("network"));
      renderSection(push);

      const card = await pushCard();
      expect(card.getByText("デスクトップ通知")).toBeInTheDocument();
      expect(error).toHaveBeenCalled();
    });

    it("プッシュの係がなければ（偽のソケットのテスト・サーバーでの描画）、デスクトップ通知のカード", async () => {
      renderSection(null);

      expect((await pushCard()).getByText("デスクトップ通知")).toBeInTheDocument();
    });

    it("状態を読むまでは何も並べない（オフを見せてから有効に変わらないように）", async () => {
      const { push } = fakePush("on");
      const pending = deferred<BrowserPushState>();
      push.state.mockReturnValue(pending.promise);
      renderSection(push);

      await waitFor(() => expect(push.state).toHaveBeenCalled());
      expect(screen.queryByRole("group", { name: "hibari 開発" })).not.toBeInTheDocument();

      await act(async () => pending.resolve("on"));
      expect((await pushCard()).getByRole("switch", { name: "プッシュ通知" })).toHaveAttribute("aria-checked", "true");
    });

    it("ページを開いたときの登録し直しで有効になったら、読み直して有効を出す（決定 4）", async () => {
      const { push, fake } = fakePush("off");
      renderSection(push);
      const card = await pushCard();
      expect(card.getByRole("switch", { name: "プッシュ通知" })).toHaveAttribute("aria-checked", "false");

      act(() => fake.setEnabled(true));

      await waitFor(() => expect(card.getByRole("switch", { name: "プッシュ通知" })).toHaveAttribute("aria-checked", "true"));
    });
  });

  describe("スイッチ", () => {
    it("オンにすると、押した操作の中で enable を呼び、確認を待つ間はオンのまま押せない", async () => {
      const { push, fake } = fakePush("off");
      const pending = deferred<BrowserPushState>();
      push.enable.mockReturnValue(pending.promise);
      renderSection(push);
      const card = await pushCard();

      // fireEvent は同期で押す。返ってすぐに呼ばれていれば、await を挟まずに呼んでいる（Safari は await の後の許可の要求を拒む）
      fireEvent.click(card.getByRole("switch", { name: "プッシュ通知" }));
      expect(push.enable).toHaveBeenCalledOnce();

      const control = card.getByRole("switch", { name: "プッシュ通知" });
      expect(control).toHaveAttribute("aria-checked", "true");
      expect(control).toBeDisabled();
      expect(card.getByText("ブラウザの確認で「許可」を選んでください")).toBeInTheDocument();

      const listed = push.listDevices.mock.calls.length;
      fake.list = devices;
      await act(async () => {
        fake.setEnabled(true);
        pending.resolve("on");
      });

      await waitFor(() => expect(card.getByText(/有効です。hibari を閉じていても/)).toBeInTheDocument());
      expect(card.getByRole("switch", { name: "プッシュ通知" })).toBeEnabled();
      // 有効にした端末が一覧に入るので、読み直す
      expect(push.listDevices.mock.calls.length).toBeGreaterThan(listed);
      expect(await screen.findByRole("group", { name: "通知を受け取る端末" })).toBeInTheDocument();
    });

    it("登録に失敗したら、オフに戻して説明を出し、もう一度押せる", async () => {
      const { push } = fakePush("off");
      push.enable.mockRejectedValueOnce(new Error("500"));
      renderSection(push);
      const card = await pushCard();

      await userEvent.click(card.getByRole("switch", { name: "プッシュ通知" }));

      expect(await card.findByText("通知を受け取る準備ができませんでした。もう一度お試しください")).toBeInTheDocument();
      const control = card.getByRole("switch", { name: "プッシュ通知" });
      expect(control).toHaveAttribute("aria-checked", "false");
      expect(control).toBeEnabled();
      expect(error).toHaveBeenCalled();

      await userEvent.click(control);
      await waitFor(() => expect(card.getByText(/有効です。hibari を閉じていても/)).toBeInTheDocument());
      expect(push.enable).toHaveBeenCalledTimes(2);
    });

    it("確認で拒否したら、拒否の表示になる", async () => {
      const { push, fake } = fakePush("off");
      push.enable.mockImplementation(async () => {
        fake.current = "denied";
        return "denied";
      });
      renderSection(push);
      const card = await pushCard();

      await userEvent.click(card.getByRole("switch", { name: "プッシュ通知" }));

      expect(await card.findByText(/アドレスバーの左のアイコンから/)).toBeInTheDocument();
      expect(card.queryByRole("switch")).not.toBeInTheDocument();
    });

    it("確認を閉じただけなら、オフに戻る", async () => {
      const { push } = fakePush("off");
      push.enable.mockResolvedValue("off");
      renderSection(push);
      const card = await pushCard();

      await userEvent.click(card.getByRole("switch", { name: "プッシュ通知" }));

      await waitFor(() => expect(push.enable).toHaveBeenCalled());
      await waitFor(() => expect(card.getByRole("switch", { name: "プッシュ通知" })).toBeEnabled());
      expect(card.getByText(/オフです。有効にすると/)).toBeInTheDocument();
    });

    it("オフにすると disable を呼び、一覧を読み直す", async () => {
      const { push, fake } = fakePush("on", devices);
      push.disable.mockImplementation(async () => {
        fake.list = devices.filter((d) => !d.is_current);
        fake.setEnabled(false);
      });
      renderSection(push);
      const card = await pushCard();
      expect(await screen.findByText("Chrome · macOS")).toBeInTheDocument();

      await userEvent.click(card.getByRole("switch", { name: "プッシュ通知" }));

      expect(push.disable).toHaveBeenCalledOnce();
      await waitFor(() => expect(card.getByText(/オフです。有効にすると/)).toBeInTheDocument());
      await waitFor(() => expect(screen.queryByText("Chrome · macOS")).not.toBeInTheDocument());
      expect(screen.getByText("Edge · Windows")).toBeInTheDocument();
    });

    it("オフにできなかったら、有効に戻る（途中と失敗の画面はデザインにないので、押した結果を先に見せる）", async () => {
      const { push } = fakePush("on");
      const pending = deferred<void>();
      push.disable.mockReturnValue(pending.promise);
      renderSection(push);
      const card = await pushCard();

      await userEvent.click(card.getByRole("switch", { name: "プッシュ通知" }));
      expect(card.getByRole("switch", { name: "プッシュ通知" })).toHaveAttribute("aria-checked", "false");

      await act(async () => pending.reject(new Error("500")));

      await waitFor(() => expect(card.getByRole("switch", { name: "プッシュ通知" })).toHaveAttribute("aria-checked", "true"));
      expect(card.queryByText(/準備ができませんでした/)).not.toBeInTheDocument();
      expect(error).toHaveBeenCalled();
    });

    it("前の操作が終わるまで、続けて押しても次を始めない", async () => {
      const { push } = fakePush("on");
      const pending = deferred<void>();
      push.disable.mockReturnValue(pending.promise);
      renderSection(push);
      const card = await pushCard();

      fireEvent.click(card.getByRole("switch", { name: "プッシュ通知" }));
      fireEvent.click(card.getByRole("switch", { name: "プッシュ通知" }));

      expect(push.disable).toHaveBeenCalledOnce();
      expect(push.enable).not.toHaveBeenCalled();
      await act(async () => pending.resolve());
    });
  });

  describe("通知を受け取る端末", () => {
    it("名前はログイン中のデバイスと同じく user_agent から作り、いまの端末には「停止する」を出さない", async () => {
      renderSection(fakePush("on", devices).push);

      const section = within(await screen.findByRole("group", { name: "通知を受け取る端末" }));
      const rows = section.getAllByRole("listitem");
      expect(rows).toHaveLength(3);
      expect(within(rows[0]).getByText("Chrome · macOS")).toBeInTheDocument();
      expect(within(rows[0]).getByText("このデバイス")).toBeInTheDocument();
      expect(within(rows[0]).getByText("10月19日に有効にしました")).toBeInTheDocument();
      expect(within(rows[0]).queryByRole("button", { name: "停止する" })).not.toBeInTheDocument();
      expect(within(rows[1]).getByText("Safari · iOS")).toBeInTheDocument();
      expect(within(rows[1]).getByRole("button", { name: "停止する" })).toBeInTheDocument();
      expect(within(rows[2]).getByText("Edge · Windows")).toBeInTheDocument();
      expect(within(rows[2]).getByText("10月12日に有効にしました")).toBeInTheDocument();
    });

    it("ほかの端末を止めると、その行が消え、一覧を読み直す", async () => {
      const { push } = fakePush("on", devices);
      renderSection(push);
      const section = within(await screen.findByRole("group", { name: "通知を受け取る端末" }));
      const listed = push.listDevices.mock.calls.length;

      const iphone = section.getByText("Safari · iOS").closest("li")!;
      await userEvent.click(within(iphone).getByRole("button", { name: "停止する" }));

      expect(push.stopDevice).toHaveBeenCalledWith("push-iphone");
      await waitFor(() => expect(section.queryByText("Safari · iOS")).not.toBeInTheDocument());
      expect(push.listDevices.mock.calls.length).toBeGreaterThan(listed);
    });

    it("止められなかったら（すでに止まっていた、など）、一覧を読み直す", async () => {
      const { push, fake } = fakePush("on", devices);
      push.stopDevice.mockImplementationOnce(async () => {
        // 別の端末ですでに止めていた
        fake.list = devices.filter((d) => d.id !== "push-iphone");
        throw new Error("404");
      });
      renderSection(push);
      const section = within(await screen.findByRole("group", { name: "通知を受け取る端末" }));

      const iphone = section.getByText("Safari · iOS").closest("li")!;
      await userEvent.click(within(iphone).getByRole("button", { name: "停止する" }));

      await waitFor(() => expect(section.queryByText("Safari · iOS")).not.toBeInTheDocument());
      expect(section.getByText("Edge · Windows")).toBeInTheDocument();
      expect(error).toHaveBeenCalled();
    });

    it("購読が 1 つもなければ節を出さない", async () => {
      renderSection(fakePush("off", []).push);

      await pushCard();
      expect(screen.queryByRole("group", { name: "通知を受け取る端末" })).not.toBeInTheDocument();
    });

    it("一覧を読めなかったら節を出さない（失敗の画面はデザインにない）", async () => {
      const { push } = fakePush("on", devices);
      push.listDevices.mockRejectedValue(new Error("network"));
      renderSection(push);

      const card = await pushCard();
      await waitFor(() => expect(error).toHaveBeenCalled());
      expect(card.getByRole("switch", { name: "プッシュ通知" })).toBeInTheDocument();
      expect(screen.queryByRole("group", { name: "通知を受け取る端末" })).not.toBeInTheDocument();
    });
  });

  it("ホーム画面にない iPhone では「追加のしかたを見る」で手順のシートを開き、閉じられる（決定 1）", async () => {
    renderSection(fakePush("install").push);
    const card = await pushCard();

    await userEvent.click(card.getByRole("button", { name: "追加のしかたを見る" }));

    const sheet = screen.getByRole("dialog", { name: "ホーム画面に追加する" });
    await userEvent.click(within(sheet).getByRole("button", { name: "閉じる" }));
    expect(screen.queryByRole("dialog", { name: "ホーム画面に追加する" })).not.toBeInTheDocument();
  });
});
