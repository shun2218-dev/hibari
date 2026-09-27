import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { HuddleBar, HuddleProblemScreen, HuddleScreen } from "./huddle-screen";
import type { HuddleScreenView } from "./types";

const you = { id: "u-you", name: "あなた" };
const naoki = { id: "u-naoki", name: "佐藤 直樹" };
const miyuki = { id: "u-miyuki", name: "高橋 みゆき" };

function huddle(overrides: Partial<HuddleScreenView> = {}): HuddleScreenView {
  return {
    room: { kind: "public", name: "デザインレビュー" },
    connection: "connected",
    participants: [
      { ...you, muted: false },
      { ...naoki, muted: false, speaking: true },
      { ...miyuki, muted: true },
    ],
    joiningSoon: [],
    muted: false,
    ...overrides,
  };
}

describe("HuddleScreen（ADR 0066 追記 C）", () => {
  it("ルームと人数を出し、話している人とミュートしている人を読み上げで区別する", () => {
    render(<HuddleScreen huddle={huddle()} />);

    expect(screen.getByRole("heading")).toHaveTextContent("デザインレビューでハドルミーティングを行う");
    expect(screen.getByText("3 人")).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "参加者" });
    expect(within(list).getByRole("figure", { name: "あなた" })).toBeInTheDocument();
    expect(within(list).getByRole("figure", { name: "佐藤 直樹（話しています）" })).toBeInTheDocument();
    expect(within(list).getByRole("figure", { name: "高橋 みゆき（ミュート中）" })).toBeInTheDocument();
  });

  it("ミュートのボタンは、押したときの操作を名前にし、押した状態を持つ", async () => {
    const onToggleMute = vi.fn();
    const { rerender } = render(<HuddleScreen huddle={huddle()} onToggleMute={onToggleMute} />);

    await userEvent.click(screen.getByRole("button", { name: "ミュート" }));
    expect(onToggleMute).toHaveBeenCalledOnce();
    rerender(<HuddleScreen huddle={huddle({ muted: true })} />);
    expect(screen.getByRole("button", { name: "ミュートを解除" })).toHaveAttribute("aria-pressed", "true");
  });

  it("機器の選択は開いているときだけ出す", async () => {
    const onToggleDeviceMenu = vi.fn();
    const { rerender } = render(<HuddleScreen huddle={huddle()} onToggleDeviceMenu={onToggleDeviceMenu} />);

    const button = screen.getByRole("button", { name: "マイクとスピーカーを選ぶ" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(button);
    expect(onToggleDeviceMenu).toHaveBeenCalledOnce();

    rerender(<HuddleScreen huddle={huddle()} deviceMenu={<p>メニュー</p>} />);
    expect(screen.getByRole("button", { name: "マイクとスピーカーを選ぶ" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("メニュー")).toBeInTheDocument();
  });

  it("ハドルのチャットは開いているときだけ出す（追記 A）", async () => {
    const onToggleChat = vi.fn();
    const { rerender } = render(<HuddleScreen huddle={huddle()} chat={<p>チャット</p>} onToggleChat={onToggleChat} />);

    expect(screen.queryByText("チャット")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "ハドルのチャット" }));
    expect(onToggleChat).toHaveBeenCalledOnce();

    rerender(<HuddleScreen huddle={huddle()} chat={<p>チャット</p>} chatOpen />);
    expect(screen.getByText("チャット")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ハドルのチャット" })).toHaveAttribute("aria-pressed", "true");
  });

  it("「退出する」で抜ける", async () => {
    const onLeave = vi.fn();
    render(<HuddleScreen huddle={huddle()} onLeave={onLeave} />);

    await userEvent.click(screen.getByRole("button", { name: "退出する" }));
    expect(onLeave).toHaveBeenCalledOnce();
  });

  it("「もうすぐ参加する」を押した人を出す（決定 11）", () => {
    render(<HuddleScreen huddle={huddle({ joiningSoon: [naoki] })} />);

    expect(screen.getByText("佐藤 直樹 さんがもうすぐ参加します")).toBeInTheDocument();
  });

  it.each([
    ["connecting", "接続しています…"],
    ["reconnecting", "再接続しています…"],
  ] as const)("%s のときは、人数の代わりにつないでいることを知らせる", (connection, text) => {
    render(<HuddleScreen huddle={huddle({ connection })} />);

    expect(screen.getByRole("status")).toHaveTextContent(text);
    expect(screen.queryByText("3 人")).not.toBeInTheDocument();
  });
});

describe("HuddleBar（ADR 0066 追記 C）", () => {
  it("ルームと人数、同じ操作の列、「新しいウィンドウで開く」と「退出する」を出す", async () => {
    const onPopOut = vi.fn();
    const onLeave = vi.fn();
    const onToggleMute = vi.fn();
    render(<HuddleBar huddle={huddle()} onPopOut={onPopOut} onLeave={onLeave} onToggleMute={onToggleMute} />);

    const bar = screen.getByRole("region", { name: "ハドルミーティング" });
    expect(bar).toHaveTextContent("デザインレビューでのハドルミーティング");
    expect(within(bar).getByText("3 人が参加中")).toBeInTheDocument();
    await userEvent.click(within(bar).getByRole("button", { name: "ミュート" }));
    await userEvent.click(within(bar).getByRole("button", { name: "ハドルミーティングを新しいウィンドウで開く" }));
    await userEvent.click(within(bar).getByRole("button", { name: "退出する" }));
    expect(onToggleMute).toHaveBeenCalledOnce();
    expect(onPopOut).toHaveBeenCalledOnce();
    expect(onLeave).toHaveBeenCalledOnce();
  });

  it("自分しかいなければ、そう書く", () => {
    render(<HuddleBar huddle={huddle({ participants: [{ ...you, muted: false }] })} />);

    expect(screen.getByText("ほかの参加者はいません")).toBeInTheDocument();
  });

  it("つないでいる間は、人数の代わりにその状態を出す", () => {
    render(<HuddleBar huddle={huddle({ connection: "reconnecting" })} />);

    expect(screen.getByRole("status")).toHaveTextContent("再接続しています…");
  });
});

describe("HuddleProblemScreen", () => {
  it.each([
    ["failed", "接続できませんでした", true],
    ["full", "参加できる人数の上限に達しています", true],
    ["disconnected", "ハドルミーティングから切断されました", true],
    ["removed", "ハドルミーティングから外れました", false],
  ] as const)("%s は「%s」と知らせ、入り直せるときだけ「もう一度参加」を出す", (problem, title, retry) => {
    render(<HuddleProblemScreen problem={problem} room={{ kind: "public", name: "デザインレビュー" }} />);

    expect(screen.getByRole("alert")).toHaveTextContent(title);
    expect(screen.queryByRole("button", { name: "もう一度参加" }) !== null).toBe(retry);
    expect(screen.getByRole("button", { name: "閉じる" })).toBeInTheDocument();
  });
});

describe("ハドルの画面と帯の「…」（ADR 0067 決定 1）", () => {
  it.each([
    { name: "ハドルの画面", view: (open: boolean, onCopyLink: () => void) => <HuddleScreen huddle={huddle()} menu={{ open, onCopyLink }} /> },
    { name: "ハドルの帯", view: (open: boolean, onCopyLink: () => void) => <HuddleBar huddle={huddle()} menu={{ open, onCopyLink }} /> },
  ])("$name から、ハドルのリンクをコピーできる", async ({ view }) => {
    const user = userEvent.setup();
    const onCopyLink = vi.fn();
    const { rerender } = render(view(false, onCopyLink));

    expect(screen.getByRole("button", { name: "その他の操作" })).toHaveAttribute("aria-expanded", "false");
    rerender(view(true, onCopyLink));
    await user.click(screen.getByRole("button", { name: "ハドルミーティングのリンクをコピー" }));
    expect(onCopyLink).toHaveBeenCalledOnce();
  });
});

describe("カメラと画面共有（ADR 0068）", () => {
  // 映像の代わり（アプリは <video>、story は画像）。部品は渡されたものを置くだけ
  const video = (label: string) => <span role="img" aria-label={label} />;

  it("camera がなければ（6.18a の画面）カメラの操作を出さず、画面を共有できなければ共有のボタンを出さない", () => {
    const { rerender } = render(<HuddleScreen huddle={huddle()} />);
    expect(screen.queryByRole("button", { name: "カメラをオンにする" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "画面を共有する" })).not.toBeInTheDocument();

    rerender(<HuddleScreen huddle={huddle({ camera: false, canShareScreen: false })} />);
    expect(screen.getByRole("button", { name: "カメラをオンにする" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("button", { name: "画面を共有する" })).not.toBeInTheDocument();
  });

  it("カメラと画面共有のボタンは、押したときの操作を名前にし、押した状態を持つ", async () => {
    const onToggleCamera = vi.fn();
    const onToggleShare = vi.fn();
    const { rerender } = render(
      <HuddleScreen huddle={huddle({ camera: false, canShareScreen: true })} onToggleCamera={onToggleCamera} onToggleShare={onToggleShare} />,
    );

    await userEvent.click(screen.getByRole("button", { name: "カメラをオンにする" }));
    await userEvent.click(screen.getByRole("button", { name: "画面を共有する" }));
    expect(onToggleCamera).toHaveBeenCalledOnce();
    expect(onToggleShare).toHaveBeenCalledOnce();

    rerender(<HuddleScreen huddle={huddle({ camera: true, canShareScreen: true, sharing: true })} />);
    expect(screen.getByRole("button", { name: "カメラをオフにする" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "画面の共有をやめる" })).toHaveAttribute("aria-pressed", "true");
  });

  it("映像があるタイルは映像を、ない人はアバターを出す", () => {
    render(
      <HuddleScreen
        huddle={huddle({
          camera: true,
          participants: [
            { ...you, muted: false, camera: true, video: video("あなたの映像") },
            { ...naoki, muted: false, camera: true, video: video("佐藤さんの映像") },
            { ...miyuki, muted: true },
          ],
        })}
      />,
    );

    const list = screen.getByRole("list", { name: "参加者" });
    expect(within(within(list).getByRole("figure", { name: "佐藤 直樹" })).getByRole("img", { name: "佐藤さんの映像" })).toBeInTheDocument();
    expect(within(within(list).getByRole("figure", { name: "高橋 みゆき（ミュート中）" })).queryByRole("img", { name: /映像/ })).not.toBeInTheDocument();
  });

  it("タイルを押すと大きくし、大きくしたタイルは押した状態を持つ", async () => {
    const onPin = vi.fn();
    const { rerender } = render(<HuddleScreen huddle={huddle()} onPin={onPin} />);

    await userEvent.click(screen.getByRole("button", { name: "佐藤 直樹を大きく表示" }));
    expect(onPin).toHaveBeenCalledWith(naoki.id);

    rerender(<HuddleScreen huddle={huddle({ pinnedId: naoki.id })} onPin={onPin} />);
    expect(screen.getByRole("button", { name: "佐藤 直樹を元の大きさに戻す" })).toHaveAttribute("aria-pressed", "true");
    // 大きくした人は下の列に出さない
    expect(within(screen.getByRole("list", { name: "参加者" })).queryByRole("figure", { name: /佐藤 直樹/ })).not.toBeInTheDocument();
  });

  it("共有された画面を大きく出し、参加者は下の列に並べる。2 つなら両方を大きく出す", () => {
    const share = (id: string, owner: typeof naoki) => ({ id, owner, video: video(`${owner.name}の画面の映像`) });
    const { rerender } = render(<HuddleScreen huddle={huddle({ screens: [share("s-naoki", naoki)] })} />);

    expect(screen.getByRole("figure", { name: "佐藤 直樹 さんの画面" })).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "参加者" })).getAllByRole("figure")).toHaveLength(3);

    rerender(<HuddleScreen huddle={huddle({ screens: [share("s-naoki", naoki), share("s-you", you)] })} />);
    expect(screen.getByRole("figure", { name: "あなたの画面" })).toBeInTheDocument();
    // 大きく出している 2 つは下の列に入らない
    expect(within(screen.getByRole("list", { name: "参加者" })).queryByRole("figure", { name: /の画面/ })).not.toBeInTheDocument();

    rerender(<HuddleScreen huddle={huddle({ screens: [share("s-naoki", naoki), share("s-you", you)], pinnedId: "s-you" })} />);
    // 押した方だけを大きくし、もう一方は下の列に回す
    expect(within(screen.getByRole("list", { name: "参加者" })).getByRole("figure", { name: "佐藤 直樹 さんの画面" })).toBeInTheDocument();
  });

  it("自分が共有している間は、琥珀の知らせと「共有をやめる」を出す", async () => {
    const onToggleShare = vi.fn();
    render(<HuddleScreen huddle={huddle({ sharing: true })} onToggleShare={onToggleShare} />);

    expect(screen.getByRole("status")).toHaveTextContent("画面を共有しています");
    await userEvent.click(screen.getByRole("button", { name: "共有をやめる" }));
    expect(onToggleShare).toHaveBeenCalledOnce();
  });

  it.each([
    { notice: "camera-denied", text: "カメラの使用を許可していません" },
    { notice: "no-camera", text: "カメラが見つかりません" },
    { notice: "screen-denied", text: "画面の共有を許可していません" },
    { notice: "screen-share-full", text: "同時に画面を共有できるのは 2 人まで" },
  ] as const)("知らせ（$notice）を出し、閉じられる", async ({ notice, text }) => {
    const onDismissNotice = vi.fn();
    render(<HuddleScreen huddle={huddle({ notice })} onDismissNotice={onDismissNotice} />);

    expect(screen.getByText(new RegExp(text))).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "知らせを閉じる" }));
    expect(onDismissNotice).toHaveBeenCalledOnce();
  });

  it("帯は映像を出さず、自分が共有していることを知らせる", () => {
    render(
      <HuddleBar
        huddle={huddle({
          camera: true,
          sharing: true,
          canShareScreen: true,
          participants: [{ ...you, muted: false, camera: true, video: video("あなたの映像") }, { ...naoki, muted: false }],
        })}
      />,
    );

    expect(screen.getByText("画面を共有しています")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "あなたの映像" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "画面の共有をやめる" })).toBeInTheDocument();
  });
});
