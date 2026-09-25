import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentDefinition, TraceEvent } from "@agentlab/contracts";
import type { HookCallbackMatcher, Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { createClaudeAgentRuntime, type ClaudeRuntimeConfig } from "../src/claude/runtime.js";
import { resolveTools } from "../src/claude/options.js";
import { createSkillFileStore } from "../src/library.js";

const agent: AgentDefinition = {
  id: "reviewer",
  name: "Reviewer",
  role: "reviewer",
  systemInstructions: "Review things.",
  model: "claude-sonnet-5",
  tools: [
    { id: "Read", name: "Read", kind: "builtin" },
    { id: "read_file", name: "read_file", kind: "function" }, // legacy alias for Read
    { id: "figma", name: "Figma", kind: "mcp", serverId: "figma", toolName: "get_file" },
    { id: "current_time", name: "Current time", kind: "function" },
  ],
};

const assistant = (id: string, content: unknown[], usage = { input_tokens: 100, output_tokens: 20 }) =>
  ({ type: "assistant", parent_tool_use_id: null, message: { id, model: "claude-sonnet-5", usage, stop_reason: null, content } }) as unknown as SDKMessage;

const success = (overrides: Record<string, unknown> = {}) =>
  ({
    type: "result",
    subtype: "success",
    is_error: false,
    result: '{"ok":true}',
    num_turns: 2,
    duration_ms: 1234,
    total_cost_usd: 0.0123,
    modelUsage: { "claude-sonnet-5": { inputTokens: 150, outputTokens: 40, cacheReadInputTokens: 50, cacheCreationInputTokens: 0 } },
    ...overrides,
  }) as unknown as SDKMessage;

/** A fake `query` that records its options, fires the tool hooks once, and replays `messages`. */
function fakeQuery(messages: SDKMessage[], seen: { options?: Options; prompt?: string }) {
  return ((params: { prompt: string; options: Options }) => {
    seen.options = params.options;
    seen.prompt = params.prompt;
    return (async function* () {
      yield { type: "system", subtype: "init", apiKeySource: "none" } as unknown as SDKMessage;
      const hooks = params.options.hooks ?? {};
      const fire = async (event: string, input: Record<string, unknown>) => {
        for (const matcher of (hooks as Record<string, HookCallbackMatcher[]>)[event] ?? []) {
          for (const hook of matcher.hooks) await hook({ hook_event_name: event, ...input } as never, undefined, { signal: new AbortController().signal });
        }
      };
      await fire("PreToolUse", { tool_name: "Read", tool_input: { file_path: "a.ts" }, tool_use_id: "t1" });
      await fire("PostToolUse", { tool_name: "Read", tool_input: { file_path: "a.ts" }, tool_response: "contents", tool_use_id: "t1", duration_ms: 5 });
      yield* messages;
    })();
  }) as unknown as ClaudeRuntimeConfig["query"];
}

async function setup(messages: SDKMessage[], extra: Partial<ClaudeRuntimeConfig> = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "agentlab-test-"));
  const skills = createSkillFileStore(path.join(root, "skills"));
  const events: TraceEvent[] = [];
  const seen: { options?: Options; prompt?: string } = {};
  let auth: string | undefined;
  const runtime = createClaudeAgentRuntime({
    skillsDir: skills.dir,
    workspaceRoot: path.join(root, "workspaces"),
    resolveMcpServer: async (id) => (id === "figma" ? { id, name: "Figma", transport: { type: "http", url: "https://mcp.figma.com/mcp" }, secretRef: "figma-token" } : undefined),
    resolveSecret: async (ref) => (ref === "figma-token" ? "s3cret" : undefined),
    onEvent: (e) => events.push(e),
    onAuth: (source) => (auth = source),
    env: { PATH: "/bin", CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "x", CLAUDE_CODE_OAUTH_TOKEN: "tok" },
    query: fakeQuery(messages, seen),
    ...extra,
  });
  return { root, skills, runtime, events, seen, getAuth: () => auth };
}

const context = { runId: "run-1", stepRunId: "step-1" };

describe("resolveTools", () => {
  it("maps builtins, legacy ids, MCP tools and function tools", () => {
    const tools = resolveTools(agent, new Set(["current_time"]));
    expect(tools.builtins).toEqual(["Read"]);
    expect(tools.allowedTools).toEqual(["Read", "mcp__figma__get_file", "mcp__agentlab__current_time"]);
    expect(tools.mcpServerIds).toEqual(["figma"]);
    expect(tools.functionToolIds).toEqual(["current_time"]);
    expect(tools.unknown).toEqual([]);
  });

  it("reports tools it cannot map", () => {
    const tools = resolveTools({ ...agent, tools: [{ id: "teleport", name: "Teleport", kind: "function" }] }, new Set());
    expect(tools.unknown).toEqual(["Teleport"]);
  });
});

describe("createClaudeAgentRuntime", () => {
  it("runs an agent and returns output, usage, tool calls and trace events", async () => {
    const { runtime, events, seen, getAuth } = await setup([
      assistant("m1", [{ type: "text", text: "Looking" }]),
      assistant("m1", [{ type: "tool_use", name: "Read" }]), // same message id: one model call
      assistant("m2", [{ type: "text", text: "Done" }]),
      success(),
    ]);

    const result = await runtime.run(agent, { pr: 42 }, context);

    expect(result.status).toBe("completed");
    expect(result.output).toEqual({ ok: true });
    expect(result.usage).toEqual({ inputTokens: 200, outputTokens: 40, estimatedCostUsd: 0.0123, latencyMs: 1234 });
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]).toMatchObject({ toolId: "Read", input: { file_path: "a.ts" }, output: "contents" });
    expect(getAuth()).toBe("subscription");

    const types = events.map((e) => e.type);
    expect(types).toEqual(["agent_start", "tool_call", "model_call", "model_call", "agent_end"]);
    expect(events.every((e) => e.runId === "run-1" && e.stepRunId === "step-1")).toBe(true);
    expect(events[2].data).toMatchObject({ messageId: "m1", text: "Looking", toolUses: ["Read"] });

    expect(seen.prompt).toContain('"pr": 42');
    expect(seen.options).toMatchObject({
      model: "claude-sonnet-5",
      systemPrompt: "Review things.",
      tools: ["Read"],
      permissionMode: "dontAsk",
      settingSources: [],
      strictMcpConfig: true,
      persistSession: false,
    });
    expect(seen.options?.mcpServers?.figma).toEqual({ type: "http", url: "https://mcp.figma.com/mcp", headers: { Authorization: "Bearer s3cret" } });
    expect(Object.keys(seen.options?.mcpServers ?? {})).toContain("agentlab");
    expect(seen.options?.env).toMatchObject({ PATH: "/bin", CLAUDE_CODE_OAUTH_TOKEN: "tok" });
    expect(seen.options?.env).not.toHaveProperty("CLAUDECODE");
    expect(seen.options?.env).not.toHaveProperty("CLAUDE_CODE_SESSION_ID");
  });

  it("streams thinking, text and tool input, and traces thinking", async () => {
    const ev = (event: unknown) => ({ type: "stream_event", parent_tool_use_id: null, event }) as unknown as SDKMessage;
    const chunks: unknown[] = [];
    const { runtime, events, seen } = await setup(
      [
        ev({ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } }),
        ev({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Hmm, " } }),
        ev({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "read it." } }),
        ev({ type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "t9", name: "Read", input: {} } }),
        ev({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"file_path":' } }),
        assistant("m1", [{ type: "thinking", thinking: "Hmm, read it." }, { type: "tool_use", name: "Read" }]),
        success(),
      ],
      { onStream: (c) => chunks.push(c) },
    );
    await runtime.run({ ...agent, tools: [] }, "x", context);

    expect(seen.options).toMatchObject({ includePartialMessages: true, thinking: { type: "adaptive", display: "summarized" } });
    expect(chunks).toEqual([
      { runId: "run-1", stepRunId: "step-1", type: "block", block: "thinking" },
      { runId: "run-1", stepRunId: "step-1", type: "delta", text: "Hmm, " },
      { runId: "run-1", stepRunId: "step-1", type: "delta", text: "read it." },
      { runId: "run-1", stepRunId: "step-1", type: "block", block: "tool_use", toolName: "Read", toolUseId: "t9" },
      { runId: "run-1", stepRunId: "step-1", type: "delta", text: '{"file_path":' },
      { runId: "run-1", stepRunId: "step-1", type: "usage", inputTokens: 100, outputTokens: 20 },
    ]);
    expect(events.find((e) => e.type === "model_call")?.data).toMatchObject({ thinking: "Hmm, read it." });
  });

  it("asks for summarized budget thinking on models without adaptive thinking", async () => {
    const { runtime, seen } = await setup([success()]);
    await runtime.run({ ...agent, tools: [], model: "claude-haiku-4-5" }, "x", context);
    expect(seen.options?.thinking).toEqual({ type: "enabled", display: "summarized" });
  });

  it("returns structured output when the agent has an output schema", async () => {
    const schema = { type: "object", properties: { verdict: { type: "string" } } };
    const { runtime, seen } = await setup([success({ result: "ignored", structured_output: { verdict: "approve" } })]);
    const result = await runtime.run({ ...agent, tools: [], outputSchema: schema }, "hi", context);
    expect(result.output).toEqual({ verdict: "approve" });
    expect(seen.options?.outputFormat).toEqual({ type: "json_schema", schema });
    expect(seen.prompt).toBe("hi");
  });

  it("copies the agent's skills into a plugin in the step workspace and enables only those", async () => {
    const { runtime, skills, root, seen } = await setup([success()]);
    await skills.save({ name: "tone-of-voice", description: "Use when writing copy.", instructions: "Be friendly." });
    await runtime.run({ ...agent, tools: [], skills: ["tone-of-voice"] }, "hi", context);
    const plugin = path.join(root, "workspaces", "run-1", "step-1", ".agentlab-skills");
    expect(await readFile(path.join(plugin, "skills", "tone-of-voice", "SKILL.md"), "utf8")).toContain("Be friendly.");
    expect(JSON.parse(await readFile(path.join(plugin, ".claude-plugin", "plugin.json"), "utf8")).name).toBe("agentlab-skills");
    expect(seen.options?.skills).toEqual(["agentlab-skills:tone-of-voice"]);
    expect(seen.options?.plugins).toEqual([{ type: "local", path: plugin, skipMcpDiscovery: true }]);
    expect(seen.options?.tools).toEqual(["Skill"]);
    expect(seen.options?.settingSources).toEqual([]);
    expect(seen.options?.cwd).toBe(path.dirname(plugin));
  });

  it("fails clearly for a missing skill, MCP server or secret", async () => {
    const { runtime } = await setup([success()]);
    expect((await runtime.run({ ...agent, tools: [], skills: ["nope"] }, "x", context)).error).toMatch(/Skills not found: nope/);
    const unregistered = { ...agent, tools: [{ id: "x", name: "X", kind: "mcp" as const, serverId: "jira" }] };
    expect((await runtime.run(unregistered, "x", context)).error).toMatch(/"jira" is not registered/);

    const noSecret = await setup([success()], { resolveSecret: async () => undefined });
    expect((await noSecret.runtime.run(agent, "x", context)).error).toMatch(/needs a secret/);
  });

  it("maps SDK failures to readable errors", async () => {
    const budget = await setup([success({ subtype: "error_max_budget_usd", is_error: true, errors: [] })]);
    const result = await budget.runtime.run({ ...agent, tools: [], limits: { maxCostUsd: 0.5 } }, "x", context);
    expect(result).toMatchObject({ status: "failed", error: "Stopped: cost limit of $0.5 reached" });
    expect(result.usage.estimatedCostUsd).toBe(0.0123);

    const rateLimited = await setup([{ ...(assistant("m1", []) as object), error: "rate_limit" } as SDKMessage]);
    expect((await rateLimited.runtime.run({ ...agent, tools: [] }, "x", context)).error).toMatch(/usage limit reached/);
  });

  it("does not create a workspace when the run is already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const { runtime, root } = await setup([success()], { signal: controller.signal });
    const result = await runtime.run({ ...agent, tools: [] }, "x", context);
    expect(result.error).toBe("Run was cancelled");
    await expect(stat(path.join(root, "workspaces", "run-1", "step-1"))).rejects.toThrow();
  });
});
