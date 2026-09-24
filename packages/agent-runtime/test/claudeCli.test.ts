import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { AgentDefinition } from "@agentlab/contracts";
import { buildClaudeArgs, createClaudeCliRuntime, type CliExec } from "../src/claudeCli.js";

const agent: AgentDefinition = {
  id: "a1",
  name: "Summarizer",
  role: "Summarizes",
  systemInstructions: "Be brief.\nUse bullet points.",
  model: "claude-sonnet-5",
  tools: [],
};
const context = { runId: "r", stepRunId: "s" };

const cliJson = (extra: Record<string, unknown>) =>
  JSON.stringify({
    is_error: false,
    subtype: "success",
    result: "done",
    total_cost_usd: 0.002,
    duration_ms: 900,
    usage: { input_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 1, output_tokens: 7 },
    ...extra,
  });

describe("buildClaudeArgs", () => {
  it("isolates the run and keeps every argument on one line", () => {
    const args = buildClaudeArgs(
      { ...agent, outputSchema: { type: "object", properties: { a: { type: "string" } } }, limits: { maxCostUsd: 0.5 } },
      { model: "claude-sonnet-5", systemPromptFile: "/tmp/x/system-prompt.md" },
    );
    expect(args).toEqual(expect.arrayContaining(["-p", "--no-session-persistence", "--strict-mcp-config"]));
    expect(args.slice(args.indexOf("--tools"), args.indexOf("--tools") + 2)).toEqual(["--tools", ""]);
    expect(args.slice(args.indexOf("--max-budget-usd"), args.indexOf("--max-budget-usd") + 2)).toEqual(["--max-budget-usd", "0.5"]);
    expect(args.every((a) => !/[\r\n]/.test(a))).toBe(true);
  });
});

describe("createClaudeCliRuntime", () => {
  it("sends the prompt on stdin and the system prompt as a file", async () => {
    let seen: { args: string[]; input: string; systemPrompt: string } | undefined;
    const exec: CliExec = async (args, { input }) => {
      const file = args[args.indexOf("--system-prompt-file") + 1];
      seen = { args, input, systemPrompt: await readFile(file, "utf8") };
      return { exitCode: 0, stdout: cliJson({}), stderr: "" };
    };
    const result = await createClaudeCliRuntime({ exec }).run(agent, { task: "hi" }, context);

    expect(result).toMatchObject({
      status: "completed",
      output: "done",
      usage: { inputTokens: 16, outputTokens: 7, estimatedCostUsd: 0.002, latencyMs: 900 },
    });
    expect(JSON.parse(seen!.input)).toEqual({ task: "hi" });
    expect(seen!.systemPrompt).toBe(agent.systemInstructions);
    expect(seen!.args[seen!.args.indexOf("--model") + 1]).toBe("claude-sonnet-5");
  });

  it("returns structured output when the agent has an output schema", async () => {
    const exec: CliExec = async () => ({ exitCode: 0, stdout: cliJson({ structured_output: { verdict: "pass" } }), stderr: "" });
    const result = await createClaudeCliRuntime({ exec }).run({ ...agent, outputSchema: { type: "object" } }, "x", context);
    expect(result.output).toEqual({ verdict: "pass" });
  });

  it("fails clearly for non-Claude models unless a fallback is set", async () => {
    const exec: CliExec = async (args) => ({ exitCode: 0, stdout: cliJson({ result: args[args.indexOf("--model") + 1] }), stderr: "" });
    const gpt = { ...agent, model: "gpt-4o" };
    expect(await createClaudeCliRuntime({ exec }).run(gpt, "x", context)).toMatchObject({
      status: "failed",
      error: expect.stringContaining("gpt-4o"),
    });
    expect((await createClaudeCliRuntime({ exec, fallbackModel: "haiku" }).run(gpt, "x", context)).output).toBe("haiku");
  });

  it("reports CLI errors, non-JSON output, timeouts and thrown errors as failures", async () => {
    const run = (exec: CliExec) => createClaudeCliRuntime({ exec }).run(agent, "x", context);
    expect(await run(async () => ({ exitCode: 1, stdout: cliJson({ is_error: true, result: "Credit balance is too low" }), stderr: "" })))
      .toMatchObject({ status: "failed", error: "Credit balance is too low", usage: { estimatedCostUsd: 0.002 } });
    expect(await run(async () => ({ exitCode: 1, stdout: "", stderr: "Not logged in" })))
      .toMatchObject({ status: "failed", error: "Claude CLI exited with 1: Not logged in" });
    expect(await run(async () => ({ exitCode: null, stdout: "", stderr: "", timedOut: true })))
      .toMatchObject({ status: "failed", error: expect.stringContaining("in time") });
    expect(await run(async () => { throw new Error("Claude Code is not installed"); }))
      .toMatchObject({ status: "failed", error: "Claude Code is not installed" });
  });
});
