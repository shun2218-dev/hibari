import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ConnectionBanner } from "./connection-banner";

describe("ConnectionBanner", () => {
  it.each([
    ["reconnecting", "接続が切れました。再接続しています…", "bg-attention-subtle"],
    ["syncing", "メッセージを同期しています", "bg-attention-subtle"],
    // 復帰は落ち着いた状態なので琥珀にしない
    ["restored", "接続が復帰しました", "bg-primary-subtle"],
  ] as const)("shows %s", (status, text, tone) => {
    render(<ConnectionBanner status={status} />);

    expect(screen.getByRole("status")).toHaveTextContent(text);
    expect(screen.getByText(text)).toHaveClass(tone);
  });

  it("keeps an empty live region while connected so that later changes are announced", () => {
    render(<ConnectionBanner status={null} />);

    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });
});
