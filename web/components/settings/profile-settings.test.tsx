import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProfileSettings } from "./profile-settings";

describe("ProfileSettings avatar", () => {
  const user = { id: "u1", displayName: "あなた", handle: "you" };

  it("offers removal only when there is an image", async () => {
    const onRemoveImage = vi.fn();
    const { rerender } = render(<ProfileSettings user={user} onRemoveImage={onRemoveImage} />);
    expect(screen.queryByRole("button", { name: "削除" })).not.toBeInTheDocument();

    rerender(<ProfileSettings user={{ ...user, avatarUrl: "https://storage.test/a.png" }} onRemoveImage={onRemoveImage} />);
    await userEvent.click(screen.getByRole("button", { name: "削除" }));
    expect(onRemoveImage).toHaveBeenCalledOnce();
  });

  it("disables changing the image while uploading", () => {
    render(<ProfileSettings user={{ ...user, avatarUrl: "https://storage.test/a.png" }} avatarState="uploading" />);

    expect(screen.getByRole("button", { name: "画像を変更" })).toBeDisabled();
    expect(screen.getByText("アップロード中…")).toBeInTheDocument();
    // アップロード中は消させない（終わってからにする）
    expect(screen.queryByRole("button", { name: "削除" })).not.toBeInTheDocument();
  });

  it("lets a failed upload be retried", async () => {
    const onRetryImage = vi.fn();
    render(<ProfileSettings user={user} avatarState="failed" onRetryImage={onRetryImage} />);

    expect(screen.getByRole("alert")).toHaveTextContent("画像をアップロードできませんでした");
    await userEvent.click(screen.getByRole("button", { name: "再試行" }));
    expect(onRetryImage).toHaveBeenCalledOnce();
    // 失敗しても、いまのアバター（頭文字）はそのまま出す
    expect(screen.getByText("あ")).toBeInTheDocument();
  });

  it("says what can be uploaded", () => {
    render(<ProfileSettings user={user} />);

    expect(screen.getByText("PNG / JPEG / WebP、2 MB まで。正方形に切り取って表示します。")).toBeInTheDocument();
  });
});
