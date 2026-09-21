import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MessageBody } from "./message-body";

const ALICE = "01J8ZZZZZZZZZZZZZZZZZZZZZA";
const names = { [ALICE]: "田中 あおい" };

describe("MessageBody", () => {
  it("メンションのない本文はそのまま出す", () => {
    render(<MessageBody body="おはようございます" />);

    expect(screen.getByText("おはようございます")).toBeInTheDocument();
  });

  it("個人のメンションは押せるチップにする（緑。6.9 でプロフィールのカードを開く）", async () => {
    const onOpenProfile = vi.fn();
    render(<MessageBody body={`<@${ALICE}> おはよう`} mentionNames={names} onOpenProfile={onOpenProfile} />);

    const chip = screen.getByRole("button", { name: "@田中 あおい" });
    expect(chip).toHaveClass("text-primary");

    await userEvent.click(chip);
    expect(onOpenProfile).toHaveBeenCalledWith(ALICE);
  });

  it("@channel と @here は琥珀で目立たせる（押せない）", () => {
    render(<MessageBody body="<!channel> と <!here>" />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("@channel")).toHaveClass("bg-attention");
    expect(screen.getByText("@here")).toHaveClass("bg-attention");
  });

  it("名前を引けない ID は書かれたままの文字列で出す", () => {
    const body = "<@01J8YYYYYYYYYYYYYYYYYYYYYY> だれ";
    render(<MessageBody body={body} mentionNames={names} />);

    expect(screen.getByText(body)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("名前を引けない ID は、書式の中でも書かれたままの文字列で出す", () => {
    render(<MessageBody body="*<@01J8YYYYYYYYYYYYYYYYYYYYYY>*" mentionNames={names} />);

    expect(screen.getByText("<@01J8YYYYYYYYYYYYYYYYYYYYYY>").tagName).toBe("STRONG");
  });
});

describe("MessageBody の書式（ADR 0051）", () => {
  it("太字・斜体・取り消し・インラインコードを、それぞれの要素で出す", () => {
    render(<MessageBody body="*太字* と _斜体_ と ~取り消し~ と `code`" />);

    expect(screen.getByText("太字").tagName).toBe("STRONG");
    expect(screen.getByText("斜体").tagName).toBe("EM");
    expect(screen.getByText("取り消し").tagName).toBe("S");
    expect(screen.getByText("code").tagName).toBe("CODE");
    expect(screen.getByText("code")).toHaveClass("font-mono");
  });

  it("コードブロックは書いたとおりに等幅で出し、中を解釈しない", () => {
    const { container } = render(<MessageBody body={"```\nconst a = *b*;\n<!here>\n```"} />);

    const pre = container.querySelector("pre");
    expect(pre).toHaveClass("font-mono");
    expect(pre).toHaveTextContent("const a = *b*; <!here>", { normalizeWhitespace: true });
    expect(pre?.textContent).toBe("const a = *b*;\n<!here>");
    expect(container.querySelector("strong")).toBeNull();
  });

  it("コードの中のメンションはチップにしない（ADR 0051 決定 5）", () => {
    render(<MessageBody body={`\`<@${ALICE}>\``} mentionNames={names} onOpenProfile={vi.fn()} />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText(`<@${ALICE}>`).tagName).toBe("CODE");
  });

  it("引用とリスト", () => {
    const { container } = render(<MessageBody body={"> 引用\n- 1\n  - 1-1\n3. 三"} />);

    expect(container.querySelector("blockquote")).toHaveTextContent("引用");
    const items = screen.getAllByRole("listitem");
    expect(items.map((li) => li.firstChild?.textContent)).toEqual(["1", "1-1", "三"]);
    // 番号は書いた値を出す
    expect(container.querySelector("ol li")).toHaveAttribute("value", "3");
  });

  it("書式のない本文は、改行を保った段落 1 つ（既存のメッセージの見た目を変えない）", () => {
    const { container } = render(<MessageBody body={"1 行目\n\n3 行目"} />);

    const paragraphs = container.querySelectorAll("p");
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]).toHaveClass("whitespace-pre-wrap");
    expect(paragraphs[0].textContent).toBe("1 行目\n\n3 行目");
  });

  it("<script> や HTML を書いても、要素にならず文字のまま出る", () => {
    const body = '<script>alert(1)</script><img src=x onerror="alert(1)"><b>太字</b>';
    const { container } = render(<MessageBody body={body} />);

    expect(container.querySelector("script, img, b")).toBeNull();
    expect(container.textContent).toBe(body);
  });

  it("URL は別のタブで開くリンクにする", () => {
    render(<MessageBody body="資料は https://example.com/docs?a=1 です。" />);

    const link = screen.getByRole("link", { name: "https://example.com/docs?a=1" });
    expect(link).toHaveAttribute("href", "https://example.com/docs?a=1");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("javascript: はリンクにしない", () => {
    render(<MessageBody body="javascript:alert(1)" />);

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("trailing は最後の段落の中に続けて出す", () => {
    render(<MessageBody body="本文" trailing={<span>（編集済み）</span>} />);

    expect(screen.getByText("（編集済み）").closest("p")).toHaveTextContent("本文（編集済み）");
  });

  it("最後がコードブロックなら、trailing はその下に出す", () => {
    const { container } = render(<MessageBody body={"```x```"} trailing={<span>（編集済み）</span>} />);

    expect(container.querySelector("pre")).not.toHaveTextContent("（編集済み）");
    expect(screen.getByText("（編集済み）")).toBeInTheDocument();
  });

  it("箇条書きの記号は段ごとに • → ◦ → ▪ にする", () => {
    const { container } = render(<MessageBody body={"- 1\n  - 2\n    - 3"} />);

    expect([...container.querySelectorAll("ul")].map((ul) => ul.className.split(" ")[0])).toEqual([
      "list-disc",
      "list-circle",
      "list-square",
    ]);
  });

  it("パーマリンクは同じタブで、アプリの中のパスへ飛ぶ（ADR 0051 決定 4）", () => {
    const ids = "01J9ZQZQZQZQZQZQZQZQZQZQZ";
    const url = `${window.location.origin}/w/${ids}A/r/${ids}B?m=${ids}C`;
    render(<MessageBody body={`これ ${url}`} />);

    const link = screen.getByRole("link", { name: url });
    expect(link).toHaveAttribute("href", `/w/${ids}A/r/${ids}B?m=${ids}C`);
    expect(link).not.toHaveAttribute("target");
  });

  it("interactive={false} では、リンクもチップも押せない要素で描く（行全体がリンクの所に置くため）", () => {
    render(
      <MessageBody body={`<@${ALICE}> https://example.com`} mentionNames={names} onOpenProfile={vi.fn()} interactive={false} />,
    );

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("@田中 あおい")).toHaveClass("text-primary");
    expect(screen.getByText("https://example.com")).toHaveClass("text-primary");
  });
});
