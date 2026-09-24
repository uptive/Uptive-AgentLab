import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  query as sdkQuery,
  type HookCallback,
  type McpServerConfig,
  type SDKAssistantMessage,
  type SDKMessage,
  type SDKPartialAssistantMessage,
  type SDKResultMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  AgentDefinition,
  AgentStreamChunk,
  AgentResult,
  AgentRunContext,
  AgentRuntime,
  AuthSource,
  McpServerDefinition,
  ToolCall,
  TraceEvent,
  TraceEventType,
  Usage,
} from "@agentlab/contracts";
import { createFunctionToolServer, FUNCTION_TOOL_IDS } from "./functionTools.js";
import {
  authSourceOf,
  buildBaseOptions,
  buildPrompt,
  childEnv,
  FUNCTION_SERVER,
  friendlyError,
  parseTextOutput,
  SKILLS_PLUGIN,
  resolveTools,
  toMcpConfig,
} from "./options.js";
import { mcpServerKey } from "../tools.js";

// Node-only: the Agent SDK starts the Claude Code binary as a subprocess.

export interface ClaudeRuntimeConfig {
  /** Folder of skill folders (`<name>/SKILL.md`); an agent's skills are copied from here into its step workspace. */
  skillsDir: string;
  /** Each step runs in its own folder `<workspaceRoot>/<runId>/<stepRunId>`. */
  workspaceRoot: string;
  resolveMcpServer: (id: string) => Promise<McpServerDefinition | undefined>;
  resolveSecret?: (ref: string) => Promise<string | undefined>;
  /** Extra folders agents may read, e.g. the repository a review flow looks at. */
  additionalDirectories?: string[];
  onEvent?: (event: TraceEvent) => void;
  /** Live token stream (thinking, text, tool input) and running token counts, for the live view. */
  onStream?: (chunk: AgentStreamChunk) => void;
  /** Called once per step with what is paying for it. */
  onAuth?: (source: AuthSource) => void;
  /** Aborts every running step. */
  signal?: AbortSignal;
  env?: Record<string, string | undefined>;
  pathToClaudeCodeExecutable?: string;
  defaultMaxTurns?: number;
  /** Injectable for tests. */
  query?: typeof sdkQuery;
  now?: () => Date;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

const ZERO_USAGE: Usage = { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, latencyMs: 0 };
const MAX_TRACE_CHARS = 20_000;

/** Keeps trace events bounded: huge tool outputs (file contents, web pages) are cut. */
function bounded(value: unknown): unknown {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text === undefined || text.length <= MAX_TRACE_CHARS) return value;
  return `${text.slice(0, MAX_TRACE_CHARS)}… [truncated ${text.length - MAX_TRACE_CHARS} characters]`;
}

/**
 * Creates the step workspace and, when the agent has skills, a local plugin in it that holds copies
 * of exactly those skills. Returns the plugin folder and any skills that were not found.
 */
async function prepareWorkspace(dir: string, skillsDir: string, skills: string[]): Promise<{ plugin?: string; missing: string[] }> {
  await fs.mkdir(dir, { recursive: true });
  const missing: string[] = [];
  const plugin = path.join(dir, ".agentlab-skills");
  for (const name of skills) {
    const source = path.join(skillsDir, name);
    try {
      await fs.access(path.join(source, "SKILL.md"));
    } catch {
      missing.push(name);
      continue;
    }
    // Copied rather than symlinked: symlinks need admin rights on Windows.
    await fs.cp(source, path.join(plugin, "skills", name), { recursive: true });
  }
  if (skills.length === missing.length) return { missing };
  await fs.mkdir(path.join(plugin, ".claude-plugin"), { recursive: true });
  await fs.writeFile(
    path.join(plugin, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: SKILLS_PLUGIN, version: "1.0.0", description: "Skills granted to this agent by AgentLab" }),
  );
  return { plugin, missing };
}

interface PendingModelCall {
  id: string;
  model: string;
  usage: SDKAssistantMessage["message"]["usage"];
  stopReason: string | null;
  thinking: string[];
  text: string[];
  toolUses: string[];
}

/** An AgentRuntime backed by the Claude Agent SDK. Create one per flow run. */
export function createClaudeAgentRuntime(config: ClaudeRuntimeConfig): AgentRuntime {
  const query = config.query ?? sdkQuery;
  const now = config.now ?? (() => new Date());

  return {
    async run(agent: AgentDefinition, input: unknown, context: AgentRunContext): Promise<AgentResult> {
      const stream = (chunk: DistributiveOmit<AgentStreamChunk, "runId" | "stepRunId">) =>
        config.onStream?.({ ...chunk, runId: context.runId, stepRunId: context.stepRunId } as AgentStreamChunk);
      const emit = (type: TraceEventType, data: unknown) =>
        config.onEvent?.({ id: randomUUID(), runId: context.runId, stepRunId: context.stepRunId, type, timestamp: now().toISOString(), data });

      const startedAt = Date.now();
      const toolCalls: ToolCall[] = [];
      const fail = (error: string, usage: Usage = { ...ZERO_USAGE, latencyMs: Date.now() - startedAt }): AgentResult => {
        emit("agent_end", { agentId: agent.id, status: "failed", error, usage });
        return { agentId: agent.id, status: "failed", output: undefined, error, usage, toolCalls };
      };

      const tools = resolveTools(agent, FUNCTION_TOOL_IDS);
      emit("agent_start", {
        agentId: agent.id,
        agentName: agent.name,
        model: agent.model,
        tools: tools.allowedTools,
        skills: agent.skills ?? [],
        input: bounded(input),
      });
      if (tools.unknown.length > 0) {
        return fail(`Unknown tools: ${tools.unknown.join(", ")}. Pick them again in the agent editor.`);
      }

      // MCP servers: registered ones plus the in-process server for function tools.
      const mcpServers: Record<string, McpServerConfig> = {};
      for (const id of tools.mcpServerIds) {
        const server = await config.resolveMcpServer(id);
        if (!server) return fail(`MCP server "${id}" is not registered. Add it under Tools & skills.`);
        const secret = server.secretRef ? await config.resolveSecret?.(server.secretRef) : undefined;
        if (server.secretRef && !secret) return fail(`MCP server "${server.name}" needs a secret that is not set on this computer.`);
        mcpServers[mcpServerKey(id)] = toMcpConfig(server, secret);
      }
      if (tools.functionToolIds.length > 0) mcpServers[FUNCTION_SERVER] = createFunctionToolServer(tools.functionToolIds);

      if (config.signal?.aborted) return fail("Run was cancelled");
      const cwd = path.join(config.workspaceRoot, context.runId, context.stepRunId);
      const workspace = await prepareWorkspace(cwd, config.skillsDir, agent.skills ?? []);
      if (workspace.missing.length > 0) return fail(`Skills not found: ${workspace.missing.join(", ")}.`);

      const abortController = new AbortController();
      const onAbort = () => abortController.abort();
      config.signal?.addEventListener("abort", onAbort);

      // Tool calls are traced from hooks, which see input, output and duration together.
      const toolStarts = new Map<string, string>();
      const preToolUse: HookCallback = async (hookInput) => {
        if (hookInput.hook_event_name === "PreToolUse") toolStarts.set(hookInput.tool_use_id, now().toISOString());
        return {};
      };
      const postToolUse: HookCallback = async (hookInput) => {
        if (hookInput.hook_event_name !== "PostToolUse" && hookInput.hook_event_name !== "PostToolUseFailure") return {};
        const failed = hookInput.hook_event_name === "PostToolUseFailure";
        const output = failed ? { error: hookInput.error } : hookInput.tool_response;
        const call: ToolCall = {
          toolId: hookInput.tool_name,
          input: hookInput.tool_input,
          output: bounded(output),
          startedAt: toolStarts.get(hookInput.tool_use_id) ?? now().toISOString(),
          completedAt: now().toISOString(),
        };
        toolCalls.push(call);
        emit("tool_call", {
          ...call,
          toolUseId: hookInput.tool_use_id,
          status: failed ? "failed" : "completed",
          durationMs: hookInput.duration_ms,
          mcpServer: "mcp_server" in hookInput ? hookInput.mcp_server?.name : undefined,
        });
        return {};
      };

      const options = {
        ...buildBaseOptions({
          agent,
          tools,
          mcpServers,
          cwd,
          skillsPlugin: workspace.plugin,
          additionalDirectories: config.additionalDirectories ?? [],
          env: childEnv(config.env ?? process.env),
          abortController,
          defaultMaxTurns: config.defaultMaxTurns,
          pathToClaudeCodeExecutable: config.pathToClaudeCodeExecutable,
        }),
        hooks: {
          PreToolUse: [{ hooks: [preToolUse] }],
          PostToolUse: [{ hooks: [postToolUse] }],
          PostToolUseFailure: [{ hooks: [postToolUse] }],
        },
      };

      // The SDK sends one assistant message per content block, all carrying the same message id and
      // usage. Buffer by id so each model call is traced (and counted) once.
      let pending: PendingModelCall | undefined;
      let streamedInput = 0;
      let streamedOutput = 0;
      let lastError: string | undefined;
      let tokenLimitHit = false;
      const flush = () => {
        if (!pending) return;
        const u = pending.usage;
        const inputTokens = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
        streamedInput += inputTokens;
        streamedOutput += u.output_tokens ?? 0;
        emit("model_call", {
          messageId: pending.id,
          model: pending.model,
          inputTokens,
          outputTokens: u.output_tokens ?? 0,
          cacheReadTokens: u.cache_read_input_tokens ?? 0,
          stopReason: pending.stopReason,
          thinking: pending.thinking.length ? bounded(pending.thinking.join("\n")) : undefined,
          text: bounded(pending.text.join("\n")),
          toolUses: pending.toolUses,
        });
        pending = undefined;
        stream({ type: "usage", inputTokens: streamedInput, outputTokens: streamedOutput });
        const maxTokens = agent.limits?.maxTokens;
        if (maxTokens && streamedInput + streamedOutput > maxTokens && !tokenLimitHit) {
          tokenLimitHit = true;
          abortController.abort();
        }
      };
      const onAssistant = (m: SDKAssistantMessage) => {
        if (m.parent_tool_use_id) return; // subagent traffic; agents are not given the Agent tool
        if (m.error) lastError = m.error;
        if (pending && pending.id !== m.message.id) flush();
        pending ??= { id: m.message.id, model: m.message.model, usage: m.message.usage, stopReason: null, thinking: [], text: [], toolUses: [] };
        pending.usage = m.message.usage;
        pending.stopReason = m.message.stop_reason ?? pending.stopReason;
        for (const block of m.message.content) {
          if (block.type === "thinking" && block.thinking) pending.thinking.push(block.thinking);
          else if (block.type === "text") pending.text.push(block.text);
          else if (block.type === "tool_use") pending.toolUses.push(block.name);
        }
      };

      // Partial messages: forward block starts and deltas so the UI can show the agent working.
      const onStreamEvent = (event: SDKPartialAssistantMessage["event"]) => {
        if (event.type === "content_block_start") {
          const block = event.content_block;
          if (block.type === "thinking" || block.type === "text") stream({ type: "block", block: block.type });
          else if (block.type === "tool_use" || block.type === "mcp_tool_use" || block.type === "server_tool_use") {
            stream({ type: "block", block: "tool_use", toolName: block.name, toolUseId: block.id });
          }
        } else if (event.type === "content_block_delta") {
          const delta = event.delta;
          if (delta.type === "thinking_delta") stream({ type: "delta", text: delta.thinking });
          else if (delta.type === "text_delta") stream({ type: "delta", text: delta.text });
          else if (delta.type === "input_json_delta") stream({ type: "delta", text: delta.partial_json });
        }
      };

      let result: SDKResultMessage | undefined;
      try {
        for await (const message of query({ prompt: buildPrompt(input), options }) as AsyncIterable<SDKMessage>) {
          if (message.type === "system" && message.subtype === "init") config.onAuth?.(authSourceOf(message.apiKeySource));
          else if (message.type === "assistant") onAssistant(message);
          else if (message.type === "stream_event" && !message.parent_tool_use_id) onStreamEvent(message.event);
          else if (message.type === "result") result = message;
        }
      } catch (error) {
        flush();
        const usage = { ...ZERO_USAGE, inputTokens: streamedInput, outputTokens: streamedOutput, latencyMs: Date.now() - startedAt };
        if (tokenLimitHit) return fail(`Stopped: token limit of ${agent.limits?.maxTokens} reached`, usage);
        if (config.signal?.aborted) return fail("Run was cancelled", usage);
        return fail(friendlyError(lastError, error instanceof Error ? error.message : String(error)), usage);
      } finally {
        config.signal?.removeEventListener("abort", onAbort);
      }
      flush();
      // A single model call can overshoot the limit without ever being aborted; still report it.
      if (tokenLimitHit) {
        return fail(`Stopped: token limit of ${agent.limits?.maxTokens} reached`, {
          ...ZERO_USAGE,
          inputTokens: streamedInput,
          outputTokens: streamedOutput,
          latencyMs: Date.now() - startedAt,
        });
      }

      if (!result) return fail(friendlyError(lastError, "Claude Code ended without a result"));

      const modelUsage = Object.values(result.modelUsage ?? {});
      const usage: Usage = {
        inputTokens: modelUsage.reduce((sum, m) => sum + m.inputTokens + m.cacheReadInputTokens + m.cacheCreationInputTokens, 0) || streamedInput,
        outputTokens: modelUsage.reduce((sum, m) => sum + m.outputTokens, 0) || streamedOutput,
        estimatedCostUsd: result.total_cost_usd,
        latencyMs: result.duration_ms,
      };

      if (result.subtype !== "success" || result.is_error) {
        const reason =
          result.subtype === "error_max_budget_usd"
            ? `Stopped: cost limit of $${agent.limits?.maxCostUsd} reached`
            : result.subtype === "error_max_turns"
              ? `Stopped after ${result.num_turns} turns without finishing (raise maxTurns in model settings)`
              : friendlyError(lastError, ("errors" in result && result.errors.join("; ")) || ("result" in result && result.result) || result.subtype);
        return fail(reason, usage);
      }

      const output = agent.outputSchema && result.structured_output !== undefined ? result.structured_output : parseTextOutput(result.result);
      emit("agent_end", { agentId: agent.id, status: "completed", usage, turns: result.num_turns, output: bounded(output) });
      return { agentId: agent.id, status: "completed", output, usage, toolCalls };
    },
  };
}
