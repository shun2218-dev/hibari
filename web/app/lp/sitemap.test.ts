import { describe, expect, it } from "vitest";

import sitemap from "./sitemap";

describe("LP の sitemap", () => {
  it("LP の 1 ページだけを載せる", () => {
    expect(sitemap()).toEqual([{ url: "http://lp.localhost:3000/" }]);
  });
});
