import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import type { MentionCandidate } from "@/lib/chat/format/mentions";
import { ChannelLinksProvider } from "@/providers/channel-links-provider";

import { AttachmentChip, Composer, TypingIndicator } from "./composer";
import { pasteInEditor, typeInEditor, valueOf } from "./editor/test-utils";

const ALICE = "01J8ZZZZZZZZZZZZZZZZZZZZZA";
const candidates: MentionCandidate[] = [
  { kind: "user", id: ALICE, handle: "alice", name: "田中 あおい" },
  { kind: "user", id: "01J8ZZZZZZZZZZZZZZZZZZZZZB", handle: "bob", name: "佐藤 直樹" },
  { kind: "channel", description: "このチャンネルの全員" },
  { kind: "here", description: "いまオンラインの人" },
];

describe("Composer", () => {
  it("sends on Enter only when there is something to send", async () => {
    const onSend = vi.fn();
    const { rerender } = render(<Composer value="" canSend={false} onSend={onSend} />);

    await userEvent.type(screen.getByRole("textbox", { name: "メッセージ" }), "{Enter}");
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "送信" })).toBeDisabled();

    rerender(<Composer value="こんにちは" canSend onSend={onSend} />);
    await userEvent.type(screen.getByRole("textbox", { name: "メッセージ" }), "{Enter}");
    expect(onSend).toHaveBeenCalledOnce();
  });

  it("grows with the text and scrolls past 16 lines（ADR 0048 のトークンを引き継ぐ）", () => {
    // 中身に合わせて伸びるのは contenteditable の性質。上限だけ --composer-max-lines のユーティリティで決める
    render(<Composer value="1 行目" canSend />);

    const box = screen.getByRole("textbox", { name: "メッセージ" });
    expect(box).toHaveClass("composer-lines");
    expect(box).toHaveClass("overflow-y-auto");
  });

  it("does not send on Shift+Enter", async () => {
    const onSend = vi.fn();
    render(<Composer value="こんにちは" canSend onSend={onSend} />);

    await userEvent.type(screen.getByRole("textbox", { name: "メッセージ" }), "{Shift>}{Enter}{/Shift}");

    expect(onSend).not.toHaveBeenCalled();
  });

  it("does not send the Enter that confirms IME composition", () => {
    const onSend = vi.fn();
    render(<Composer value="こんにちは" canSend onSend={onSend} />);

    fireEvent.keyDown(screen.getByRole("textbox", { name: "メッセージ" }), { key: "Enter", isComposing: true });

    expect(onSend).not.toHaveBeenCalled();
    expect(valueOf(screen.getByRole("textbox", { name: "メッセージ" }))).toBe("こんにちは");
  });

  // Safari は変換の終わり（compositionend）を先に知らせてから、確定の Enter の keydown を送る。
  // そのため isComposing は false で、IME が処理したことは keyCode 229 でしか分からない
  it("does not send the Enter that confirms IME composition in Safari (isComposing is false, keyCode is 229)", () => {
    const onSend = vi.fn();
    render(<Composer value="こんにちは" canSend onSend={onSend} />);

    const box = screen.getByRole("textbox", { name: "メッセージ" });
    fireEvent.compositionStart(box);
    fireEvent.compositionEnd(box, { data: "こんにちは" });
    fireEvent.keyDown(box, { key: "Enter", keyCode: 229, isComposing: false });

    expect(onSend).not.toHaveBeenCalled();
    // 改行も入れない
    expect(valueOf(box)).toBe("こんにちは");
  });

  it("sends on the next Enter after the composition is confirmed", () => {
    const onSend = vi.fn();
    render(<Composer value="こんにちは" canSend onSend={onSend} />);

    const box = screen.getByRole("textbox", { name: "メッセージ" });
    fireEvent.keyDown(box, { key: "Enter", keyCode: 229 });
    fireEvent.keyDown(box, { key: "Enter", keyCode: 13 });

    expect(onSend).toHaveBeenCalledOnce();
  });

  it("reports the files chosen from the attach button", async () => {
    const onSelectFiles = vi.fn();
    const { container } = render(<Composer value="" canSend={false} onSelectFiles={onSelectFiles} />);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const click = vi.spyOn(input, "click");
    const files = [new File(["a"], "a.png", { type: "image/png" }), new File(["b"], "b.fig")];

    await userEvent.click(screen.getByRole("button", { name: "ファイルを添付" }));
    expect(click).toHaveBeenCalledOnce();
    await userEvent.upload(input, files);

    expect(onSelectFiles).toHaveBeenCalledWith(files);
  });

  it("reports typed text", async () => {
    const onChange = vi.fn();
    render(<Composer value="" canSend={false} onChange={onChange} />);

    await typeInEditor(screen.getByRole("textbox", { name: "メッセージ" }), "a");

    expect(onChange).toHaveBeenCalledWith("a");
  });

  it("offers posting a thread reply to the channel too", async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <Composer
        value=""
        canSend={false}
        target="thread"
        alsoInChannel={{ label: "チャンネルにも投稿する", checked: false, onChange }}
      />,
    );

    const checkbox = screen.getByRole("checkbox", { name: "チャンネルにも投稿する" });
    expect(checkbox).not.toBeChecked();
    await userEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith(true);

    rerender(
      <Composer
        value=""
        canSend={false}
        target="thread"
        alsoInChannel={{ label: "チャンネルにも投稿する", checked: true, onChange }}
      />,
    );
    expect(screen.getByRole("checkbox", { name: "チャンネルにも投稿する" })).toBeChecked();
  });

  it("has no channel checkbox unless asked for", () => {
    render(<Composer value="" canSend={false} />);

    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});

describe("Composer の @ 補完（ADR 0043 / 0052 決定 4）", () => {
  /** 親が本文を持つので、テストの中でも同じように持ち回る。 */
  function Harness({ onSend }: { onSend?: () => void } = {}) {
    const [value, setValue] = useState("");
    return <Composer value={value} onChange={setValue} canSend onSend={onSend} mentionCandidates={candidates} />;
  }

  const candidatesList = () => screen.getByRole("listbox", { name: "メンションの候補" });
  const queryCandidates = () => screen.queryByRole("listbox", { name: "メンションの候補" });

  it("@ を打つと候補が出て、選ぶとチップが入り、値はトークンになる", async () => {
    render(<Harness />);
    const input = screen.getByRole("textbox", { name: "メッセージ" });

    await typeInEditor(input, "やあ @ali");

    expect(within(candidatesList()).getByText("田中 あおい")).toBeInTheDocument();
    expect(within(candidatesList()).queryByText("佐藤 直樹")).not.toBeInTheDocument();

    await userEvent.click(within(candidatesList()).getByText("田中 あおい"));
    // 入力欄には名前のチップ、送る値はトークン（ADR 0052 決定 3）
    expect(within(input).getByText("@田中 あおい")).toHaveClass("text-primary");
    expect(valueOf(input)).toBe(`やあ <@${ALICE}> `);
    expect(queryCandidates()).not.toBeInTheDocument();
  });

  it("確定したあとに打った文字は、チップの後ろに続く", async () => {
    render(<Harness />);
    const input = screen.getByRole("textbox", { name: "メッセージ" });

    await typeInEditor(input, "@ali");
    await userEvent.click(within(candidatesList()).getByText("田中 あおい"));
    await typeInEditor(input, "おはよう");

    expect(valueOf(input)).toBe(`<@${ALICE}> おはよう`);
  });

  it("↑↓ で選び、Enter で確定する（送信しない）", async () => {
    const onSend = vi.fn();
    render(<Harness onSend={onSend} />);
    const input = screen.getByRole("textbox", { name: "メッセージ" });

    await typeInEditor(input, "@");
    // 並びは @channel・@here・田中・佐藤（全員宛てが先）。↓ を 3 回で佐藤
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{Enter}");

    expect(valueOf(input)).toBe("<@01J8ZZZZZZZZZZZZZZZZZZZZZB> ");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("Escape で閉じると、次の Enter は送信になる", async () => {
    const onSend = vi.fn();
    render(<Harness onSend={onSend} />);
    const input = screen.getByRole("textbox", { name: "メッセージ" });

    await typeInEditor(input, "@ali");
    await userEvent.keyboard("{Escape}");
    expect(queryCandidates()).not.toBeInTheDocument();

    await userEvent.keyboard("{Enter}");
    expect(onSend).toHaveBeenCalledOnce();
  });

  it("全員宛ては先に、メガホンの印で出し、操作の案内を添える（Slack と同じ）", async () => {
    render(<Harness />);

    await typeInEditor(screen.getByRole("textbox", { name: "メッセージ" }), "@");

    const options = within(candidatesList()).getAllByRole("option");
    expect(options).toHaveLength(4);
    expect(options[0]).toHaveTextContent("@channel");
    expect(options[1]).toHaveTextContent("@here");
    expect(options[2]).toHaveTextContent("田中 あおい");
    expect(options[3]).toHaveTextContent("佐藤 直樹");
    // 全員宛ては写真の代わりにメガホン（svg）、個人は写真（頭文字）
    expect(options[0].querySelector("svg")).not.toBeNull();
    expect(options[2].querySelector("svg")).toBeNull();
    expect(screen.getByText("↑↓ で移動")).toBeInTheDocument();
    expect(screen.getByText("esc：キャンセル")).toBeInTheDocument();
  });

  it("@channel と @here も候補に出る", async () => {
    render(<Harness />);

    await typeInEditor(screen.getByRole("textbox", { name: "メッセージ" }), "@ch");

    expect(within(candidatesList()).getByText("@channel")).toBeInTheDocument();
    expect(within(candidatesList()).queryByText("@here")).not.toBeInTheDocument();
  });

  it("誰にも当たらなければ閉じたままにし、Enter は送信になる", async () => {
    const onSend = vi.fn();
    render(<Harness onSend={onSend} />);

    await typeInEditor(screen.getByRole("textbox", { name: "メッセージ" }), "@zzz");
    expect(queryCandidates()).not.toBeInTheDocument();

    await userEvent.keyboard("{Enter}");
    expect(onSend).toHaveBeenCalledOnce();
  });

  it("メールアドレスの @ では開かない", async () => {
    render(<Harness />);

    await typeInEditor(screen.getByRole("textbox", { name: "メッセージ" }), "mail@ali");

    expect(queryCandidates()).not.toBeInTheDocument();
  });

  it("コードの中では開かない（ADR 0051 決定 5）", async () => {
    render(<Harness />);
    const input = screen.getByRole("textbox", { name: "メッセージ" });

    await typeInEditor(input, "前 ");
    await userEvent.click(screen.getByRole("button", { name: /^コード（/ }));
    await typeInEditor(input, "@ali");

    expect(queryCandidates()).not.toBeInTheDocument();
  });

  it("候補を渡さなければ補完は開かない", async () => {
    render(<Composer value="" canSend />);

    await typeInEditor(screen.getByRole("textbox", { name: "メッセージ" }), "@ali");

    expect(queryCandidates()).not.toBeInTheDocument();
  });
});

describe("Composer の # 補完（ADR 0062 決定 4）", () => {
  const ZATSUDAN = "01J8ZZZZZZZZZZZZZZZZZZZZZ1";
  const RELEASE = "01J8ZZZZZZZZZZZZZZZZZZZZZ2";
  const REVIEW = "01J8ZZZZZZZZZZZZZZZZZZZZZ3";
  const DESIGN = "01J8ZZZZZZZZZZZZZZZZZZZZZ4";
  const OLD = "01J8ZZZZZZZZZZZZZZZZZZZZZ5";
  const channels = {
    [ZATSUDAN]: { id: ZATSUDAN, name: "雑談", private: false, archived: false },
    [RELEASE]: { id: RELEASE, name: "リリース準備", private: true, archived: false },
    [REVIEW]: { id: REVIEW, name: "デザインレビュー", private: false, archived: false },
    [DESIGN]: { id: DESIGN, name: "デザイン", private: false, archived: false },
    [OLD]: { id: OLD, name: "デザイン旧", private: false, archived: true },
  };

  function Harness({ onSend }: { onSend?: () => void } = {}) {
    const [value, setValue] = useState("");
    return (
      <ChannelLinksProvider value={{ channels, href: (id) => `/r/${id}` }}>
        <Composer value={value} onChange={setValue} canSend onSend={onSend} mentionCandidates={candidates} />
      </ChannelLinksProvider>
    );
  }

  const channelList = () => screen.getByRole("listbox", { name: "チャンネルの候補" });
  const queryChannelList = () => screen.queryByRole("listbox", { name: "チャンネルの候補" });

  it("# を打つとチャンネルの候補が出て、選ぶと #名前 のチップが入り、値は <#ID> になる", async () => {
    render(<Harness />);
    const input = screen.getByRole("textbox", { name: "メッセージ" });

    await typeInEditor(input, "見て #雑");
    await userEvent.click(within(channelList()).getByText("雑談"));

    expect(within(input).getByText("#雑談")).toHaveClass("text-primary");
    expect(valueOf(input)).toBe(`見て <#${ZATSUDAN}> `);
    expect(queryChannelList()).not.toBeInTheDocument();
  });

  it("前方一致を先に並べ、アーカイブ済みは出さない。private には鍵の印を付ける", async () => {
    render(<Harness />);
    const input = screen.getByRole("textbox", { name: "メッセージ" });

    await typeInEditor(input, "#デザ");
    expect(within(channelList()).getAllByRole("option").map((o) => o.textContent)).toEqual(["デザイン", "デザインレビュー"]);

    await userEvent.keyboard("{Escape}");
    await typeInEditor(input, " #リリ");
    expect(within(channelList()).getByRole("img", { name: "非公開" })).toBeInTheDocument();
  });

  it("Enter で確定する（送信しない）", async () => {
    const onSend = vi.fn();
    render(<Harness onSend={onSend} />);
    const input = screen.getByRole("textbox", { name: "メッセージ" });

    await typeInEditor(input, "#デザ");
    await userEvent.keyboard("{ArrowDown}{Enter}");

    expect(valueOf(input)).toBe(`<#${REVIEW}> `);
    expect(onSend).not.toHaveBeenCalled();
  });

  it("URL の # では開かない", async () => {
    render(<Harness />);

    await typeInEditor(screen.getByRole("textbox", { name: "メッセージ" }), "https://example.com/#雑");

    expect(queryChannelList()).not.toBeInTheDocument();
  });

  it("手で打った #名前 も、後ろに空白を打つとチップになる（いちばん長い一致）", async () => {
    render(<Harness />);
    const input = screen.getByRole("textbox", { name: "メッセージ" });

    await typeInEditor(input, "#デザインレビュー を見て");
    await userEvent.keyboard("{Escape}");

    expect(valueOf(input)).toBe(`<#${REVIEW}> を見て`);
  });

  it("送るときは、末尾に残った #名前 も変える", async () => {
    const onSend = vi.fn();
    render(<Harness onSend={onSend} />);
    const input = screen.getByRole("textbox", { name: "メッセージ" });

    await typeInEditor(input, "移動: #雑談");
    await userEvent.keyboard("{Escape}{Enter}");

    expect(onSend).toHaveBeenCalledOnce();
    expect(valueOf(input)).toBe(`移動: <#${ZATSUDAN}>`);
  });

  it("一致しない #名前 は文字のまま", async () => {
    render(<Harness />);
    const input = screen.getByRole("textbox", { name: "メッセージ" });

    await typeInEditor(input, "#1 と #TODO です");

    expect(valueOf(input)).toBe("#1 と #TODO です");
  });
});

describe("Composer の書式（ADR 0052 決定 5）", () => {
  function Harness({ toolbarVisible = true, onToggleToolbar }: { toolbarVisible?: boolean; onToggleToolbar?: (v: boolean) => void }) {
    const [value, setValue] = useState("");
    return <Composer value={value} onChange={setValue} canSend toolbarVisible={toolbarVisible} onToggleToolbar={onToggleToolbar} />;
  }

  it("記号を打つとその場で書式になり、続けて打つ文字は書式なし", async () => {
    render(<Harness />);
    const input = screen.getByRole("textbox", { name: "メッセージ" });

    await typeInEditor(input, "これは*太字*です");

    expect(within(input).getByText("太字").tagName).toBe("STRONG");
    expect(valueOf(input)).toBe("これは*太字*です");
  });

  it.each([
    ["_斜体_", "EM", "_斜体_"],
    ["__下線__", "SPAN", "__下線__"],
    ["~取り消し~", "SPAN", "~取り消し~"],
    ["`code`", "CODE", "`code`"],
  ])("%s も書式になる", async (typed, _tag, want) => {
    render(<Harness />);
    const input = screen.getByRole("textbox", { name: "メッセージ" });

    await typeInEditor(input, typed);

    expect(valueOf(input)).toBe(want);
    expect(input.textContent).not.toContain(typed.slice(0, 1));
  });

  it("識別子の _ は斜体にしない（ADR 0051 の境界の規則）", async () => {
    render(<Harness />);
    const input = screen.getByRole("textbox", { name: "メッセージ" });

    await typeInEditor(input, "snake_case_name");

    expect(input.textContent).toBe("snake_case_name");
  });

  it("ツールバーの太字を押してから打つと太字になる", async () => {
    render(<Harness />);
    const input = screen.getByRole("textbox", { name: "メッセージ" });

    await typeInEditor(input, "前 ");
    await userEvent.click(screen.getByRole("button", { name: /^太字（/ }));
    await typeInEditor(input, "太字");

    expect(valueOf(input)).toBe("前 *太字*");
    expect(screen.getByRole("button", { name: /^太字（/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("ツールバーは Slack と同じ並びで、ショートカットを添える", () => {
    render(<Harness />);

    const toolbar = screen.getByRole("toolbar", { name: "書式" });
    expect(within(toolbar).getAllByRole("button").map((b) => b.getAttribute("aria-label")?.replace(/（.*）/u, ""))).toEqual([
      "太字",
      "斜体",
      "下線",
      "取り消し線",
      "リンク",
      "コード",
      "引用",
      "コードブロック",
      "番号付きリスト",
      "箇条書き",
    ]);
    // サーバーでの描画に合わせて、最初は Ctrl で描く（jsdom は Mac ではない）
    expect(within(toolbar).getByRole("button", { name: "取り消し線（Ctrl Shift X）" })).toBeInTheDocument();
  });

  it("送信はアイコンのボタン。送れる内容がなければ押せない", () => {
    const { rerender } = render(<Composer value="" canSend={false} />);

    expect(screen.getByRole("button", { name: "送信" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "送信" })).not.toHaveTextContent("送信");

    rerender(<Composer value="こんにちは" canSend />);
    expect(screen.getByRole("button", { name: "送信" })).toBeEnabled();
  });

  it("ツールバーの切り替えは下線付きの「Aa」", () => {
    render(<Harness />);

    const toggle = screen.getByRole("button", { name: "書式のツールバーを隠す" });
    expect(toggle).toHaveTextContent("Aa");
    expect(toggle).toHaveClass("underline");
    expect(toggle).toHaveAttribute("aria-pressed", "true");
  });

  it("ツールバーを隠せる。隠しても記号の入力は効く", async () => {
    const onToggleToolbar = vi.fn();
    const { rerender } = render(<Harness onToggleToolbar={onToggleToolbar} />);

    await userEvent.click(screen.getByRole("button", { name: "書式のツールバーを隠す" }));
    expect(onToggleToolbar).toHaveBeenCalledWith(false);

    rerender(<Harness toolbarVisible={false} onToggleToolbar={onToggleToolbar} />);
    expect(screen.queryByRole("toolbar", { name: "書式" })).not.toBeInTheDocument();
    const input = screen.getByRole("textbox", { name: "メッセージ" });
    await typeInEditor(input, "*太字*");
    expect(valueOf(input)).toBe("*太字*");
    expect(within(input).getByText("太字").tagName).toBe("STRONG");
  });

  it("ほかのページから貼ると、記法で書ける書式が残る", async () => {
    render(<Harness />);
    const input = screen.getByRole("textbox", { name: "メッセージ" });

    await pasteInEditor(input, {
      html: '<p><strong>太字</strong>と<a href="https://example.com/docs">手順書</a></p><ul><li>a</li><li>b</li></ul><pre><code>x = 1</code></pre><h2>見出し</h2>',
      text: "太字と手順書",
    });

    expect(valueOf(input)).toBe("*太字*と<https://example.com/docs|手順書>\n- a\n- b\n```\nx = 1\n```\n見出し");
  });

  it("http / https でないリンクを貼ると、文字だけが残る", async () => {
    render(<Harness />);
    const input = screen.getByRole("textbox", { name: "メッセージ" });

    await pasteInEditor(input, { html: '<a href="javascript:alert(1)">押して</a>', text: "押して" });

    expect(valueOf(input)).toBe("押して");
  });

  it("テキストだけを貼ると、記号は解釈しない", async () => {
    render(<Harness />);
    const input = screen.getByRole("textbox", { name: "メッセージ" });

    await pasteInEditor(input, { text: "2 *3* 4" });

    expect(input.querySelector("strong")).toBeNull();
    expect(input.textContent).toBe("2 *3* 4");
  });
});

describe("TypingIndicator", () => {
  it("names who is typing", () => {
    render(<TypingIndicator names={["高橋 みゆき", "中村 涼"]} />);

    expect(screen.getByText("高橋 みゆき、中村 涼 が入力中")).toBeInTheDocument();
  });

  it("renders nothing visible when nobody is typing", () => {
    const { container } = render(<TypingIndicator names={[]} />);

    expect(container.firstChild).toBeEmptyDOMElement();
  });
});

describe("AttachmentChip", () => {
  it("shows upload progress", async () => {
    const onRemove = vi.fn();
    render(
      <AttachmentChip attachment={{ id: "a1", fileName: "sidebar.fig", status: "uploading", progress: 62 }} onRemove={onRemove} />,
    );

    expect(screen.getByRole("progressbar", { name: "sidebar.fig をアップロード中" })).toHaveAttribute("aria-valuenow", "62");
    expect(screen.getByText("62%")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "アップロードを取り消す" }));
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it("offers retry and cancel when the upload failed", async () => {
    const onRetry = vi.fn();
    const onRemove = vi.fn();
    render(
      <AttachmentChip
        attachment={{ id: "a1", fileName: "sidebar.fig", status: "failed" }}
        onRetry={onRetry}
        onRemove={onRemove}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("アップロードできませんでした");
    // 再試行と取り消しはアイコンのボタン
    expect(screen.getByRole("button", { name: "再試行" })).not.toHaveTextContent("再試行");
    await userEvent.click(screen.getByRole("button", { name: "再試行" }));
    await userEvent.click(screen.getByRole("button", { name: "取り消し" }));

    expect(onRetry).toHaveBeenCalledOnce();
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it("shows the size once uploaded", () => {
    render(<AttachmentChip attachment={{ id: "a1", fileName: "sidebar.fig", status: "uploaded", sizeLabel: "1.8 MB" }} />);

    expect(screen.getByRole("img", { name: "アップロード済み" })).toBeInTheDocument();
    expect(screen.getByText("1.8 MB")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
});

