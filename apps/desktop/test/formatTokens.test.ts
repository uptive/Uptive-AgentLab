import { describe, expect, it } from "vitest";
import { formatTokens } from "../src/runs/format.js";

describe("formatTokens", () => {
  it("shows the cached part in parentheses", () => {
    expect(formatTokens(123_456, 100_000, "tok")).toBe("123,456 tok (100,000 cached)");
  });

  it("leaves out the parentheses when nothing was cached or it isn't known", () => {
    expect(formatTokens(1_234, 0)).toBe("1,234");
    expect(formatTokens(1_234, undefined, "tokens")).toBe("1,234 tokens");
  });
});
