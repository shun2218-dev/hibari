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

  it("@channel と @here は押せない（琥珀にも緑にもしない）", () => {
    render(<MessageBody body="<!channel> と <!here>" />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("@channel")).toHaveClass("text-text-secondary");
    expect(screen.getByText("@here")).toHaveClass("text-text-secondary");
  });

  it("名前を引けない ID は書かれたままの文字列で出す", () => {
    const body = "<@01J8YYYYYYYYYYYYYYYYYYYYYY> だれ";
    render(<MessageBody body={body} mentionNames={names} />);

    expect(screen.getByText(body)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
