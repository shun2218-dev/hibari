import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StreamVideo } from "./stream-video";

describe("StreamVideo（ADR 0068）", () => {
  afterEach(() => vi.restoreAllMocks());

  it("ストリームを音なしで映し、外したら離す", () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const first = {} as MediaStream;
    const second = {} as MediaStream;
    const { container, rerender, unmount } = render(<StreamVideo stream={first} />);
    const video = container.querySelector("video") as HTMLVideoElement & { srcObject: unknown };

    expect(video.srcObject).toBe(first);
    expect(video.muted).toBe(true);
    expect(play).toHaveBeenCalled();

    rerender(<StreamVideo stream={second} />);
    expect(video.srcObject).toBe(second);

    unmount();
    expect(video.srcObject).toBeNull();
  });
});
