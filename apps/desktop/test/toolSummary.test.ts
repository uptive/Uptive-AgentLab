import { describe, expect, it } from "vitest";
import { summarizeToolCall, toolDisplayName } from "../src/runs/toolSummary.js";
import { contentBlocksText, humanizeKey } from "../src/runs/readable.js";

describe("summarizeToolCall", () => {
  it("describes common tools by their main argument", () => {
    expect(summarizeToolCall("Read", { file_path: "src/a.ts" })).toEqual({ title: "Read file", detail: "src/a.ts", mono: true });
    expect(summarizeToolCall("Bash", { command: "ls -la" })).toMatchObject({ title: "Run command", detail: "ls -la" });
    expect(summarizeToolCall("Grep", { pattern: "foo", path: "src" })).toMatchObject({ detail: "foo  in src" });
    expect(summarizeToolCall("TodoWrite", { todos: [1, 2] })).toMatchObject({ detail: "2 items" });
  });

  it("falls back to a readable name for unknown and MCP tools", () => {
    expect(summarizeToolCall("mcp__github__create_issue", { title: "x" })).toEqual({ title: "github · create issue", mono: false });
    expect(toolDisplayName(undefined)).toBe("Tool");
  });

  it("tolerates missing or malformed input", () => {
    expect(summarizeToolCall("Read", undefined)).toEqual({ title: "Read file", detail: undefined, mono: true });
    expect(summarizeToolCall("Bash", { command: 42 }).detail).toBeUndefined();
  });
});

describe("readable value helpers", () => {
  it("humanizes snake and camel case keys", () => {
    expect(humanizeKey("file_path")).toBe("File path");
    expect(humanizeKey("maxTokens")).toBe("Max tokens");
  });

  it("joins text content blocks and rejects anything else", () => {
    expect(contentBlocksText([{ type: "text", text: "a" }, { type: "text", text: "b" }])).toBe("a\nb");
    expect(contentBlocksText([{ type: "image" }])).toBeUndefined();
    expect(contentBlocksText("text")).toBeUndefined();
  });
});
