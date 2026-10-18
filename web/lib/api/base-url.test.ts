import { describe, expect, it } from "vitest";

import { getApiBaseUrl } from "./base-url";

describe("getApiBaseUrl", () => {
  it.each([
    ["http://localhost:8080", "http://localhost:8080"],
    ["http://localhost:8080/", "http://localhost:8080"],
    ["https://api.example.com/base/", "https://api.example.com/base"],
  ])("normalizes %s", (input, want) => {
    expect(getApiBaseUrl(input)).toBe(want);
  });

  it.each([
    ["unset", undefined, /is not set/],
    ["empty", "", /is not set/],
    ["not a URL", "localhost:8080", /http\(s\)|valid URL/],
    ["relative", "/api", /valid URL/],
    ["other scheme", "ws://localhost:8080", /http\(s\)/],
    ["query", "http://localhost:8080?x=1", /query or fragment/],
  ])("rejects %s", (_name, input, message) => {
    expect(() => getApiBaseUrl(input)).toThrow(message);
  });
});
