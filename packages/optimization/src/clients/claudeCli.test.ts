import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClaudeCliError, createClaudeCliModelClient } from "./claudeCli.js";

const dir = mkdtempSync(path.join(tmpdir(), "fake-claude-"));
let count = 0;

/** Writes an executable stand-in for `claude` whose behavior is the given Node code. */
function fakeCli(body: string): string {
  const file = path.join(dir, `claude-${count++}.mjs`);
  writeFileSync(
    file,
    `#!/usr/bin/env node
let stdin = "";
process.stdin.setEncoding("utf8").on("data", (c) => (stdin += c)).on("end", () => { ${body} });
`,
  );
  chmodSync(file, 0o755);
  return file;
}

const envelope = (fields: Record<string, unknown>) =>
  `process.stdout.write(JSON.stringify(${JSON.stringify({ type: "result", subtype: "success", is_error: false, ...fields })}));`;

const request = { system: "Respond only with JSON.", prompt: "x".repeat(300_000), schema: { type: "object" } };

describe("Claude Code CLI model client", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sends the prompt on stdin with tools disabled and returns structured_output", async () => {
    const bin = fakeCli(`process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "{}",
      structured_output: { argv: process.argv.slice(2), stdinLength: stdin.length, hasApiKey: "ANTHROPIC_API_KEY" in process.env } }));`);
    process.env.ANTHROPIC_API_KEY = "should-not-reach-the-cli";
    try {
      const out = (await createClaudeCliModelClient({ bin, model: "haiku" }).generateJson(request)) as {
        argv: string[];
        stdinLength: number;
        hasApiKey: boolean;
      };
      expect(out.stdinLength).toBe(300_000);
      expect(out.hasApiKey).toBe(false);
      expect(out.argv).toEqual(expect.arrayContaining(["-p", "--output-format", "json", "--strict-mcp-config", "--no-session-persistence"]));
      expect(out.argv[out.argv.indexOf("--tools") + 1]).toBe("");
      expect(out.argv[out.argv.indexOf("--model") + 1]).toBe("haiku");
      expect(JSON.parse(out.argv[out.argv.indexOf("--json-schema") + 1])).toEqual({ type: "object" });
      expect(out.argv.join(" ")).not.toContain("xxxx");
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it("uses the request's model, then the default Sonnet 5", async () => {
    const bin = fakeCli(`process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "{}",
      structured_output: { model: process.argv[process.argv.indexOf("--model") + 1] } }));`);
    const client = createClaudeCliModelClient({ bin });
    await expect(client.generateJson({ ...request, model: "claude-opus-5-5" })).resolves.toEqual({ model: "claude-opus-5-5" });
    const saved = process.env.AGENT_MODEL;
    delete process.env.AGENT_MODEL;
    try {
      await expect(createClaudeCliModelClient({ bin }).generateJson(request)).resolves.toEqual({ model: "claude-sonnet-5" });
    } finally {
      if (saved !== undefined) process.env.AGENT_MODEL = saved;
    }
  });

  it("parses `result` as JSON when there is no structured_output", async () => {
    const bin = fakeCli(envelope({ result: '{"findings":[]}' }));
    await expect(createClaudeCliModelClient({ bin }).generateJson(request)).resolves.toEqual({ findings: [] });
  });

  it("logs the raw text and throws a clear error when `result` is not JSON", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const bin = fakeCli(envelope({ result: "Sure! Here are my findings: the planner is fine." }));
    await expect(createClaudeCliModelClient({ bin }).generateJson(request)).rejects.toMatchObject({
      kind: "invalid-output",
      message: expect.stringContaining("text instead of JSON"),
    });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Sure! Here are my findings"));
  });

  it("reports a missing binary", async () => {
    await expect(createClaudeCliModelClient({ bin: path.join(dir, "does-not-exist") }).generateJson(request)).rejects.toMatchObject({
      kind: "not-installed",
      message: expect.stringContaining("Claude Code CLI not found"),
    });
  });

  it("reports when Claude Code is not logged in", async () => {
    const bin = fakeCli(envelope({ subtype: "success", is_error: true, result: "Not logged in · Please run /login" }));
    await expect(createClaudeCliModelClient({ bin }).generateJson(request)).rejects.toMatchObject({
      kind: "not-logged-in",
      message: expect.stringContaining("log in with your Claude.ai account"),
    });
  });

  it("reports the usage limit", async () => {
    const bin = fakeCli(envelope({ is_error: true, result: "Claude AI usage limit reached|1790276400" }));
    await expect(createClaudeCliModelClient({ bin }).generateJson(request)).rejects.toMatchObject({ kind: "usage-limit" });

    const rateLimited = fakeCli(envelope({ is_error: true, api_error_status: 429, result: "API Error" }));
    await expect(createClaudeCliModelClient({ bin: rateLimited }).generateJson(request)).rejects.toMatchObject({ kind: "usage-limit" });
  });

  it("reports a crash with stderr when there is no JSON output", async () => {
    const bin = fakeCli(`process.stderr.write("Error: something broke"); process.exit(1);`);
    await expect(createClaudeCliModelClient({ bin }).generateJson(request)).rejects.toMatchObject({
      kind: "failed",
      message: expect.stringContaining("something broke"),
    });
  });

  it("times out and kills a call that hangs", async () => {
    const bin = fakeCli(`setTimeout(() => {}, 60_000);`);
    const error = (await createClaudeCliModelClient({ bin, timeoutMs: 300 }).generateJson(request).catch((e: unknown) => e)) as ClaudeCliError;
    expect(error).toBeInstanceOf(ClaudeCliError);
    expect(error.kind).toBe("timeout");
  });
});
