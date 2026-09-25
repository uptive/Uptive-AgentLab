import type { AgentDefinition, AuthSource, McpServerDefinition } from "@agentlab/contracts";
import type { ApiKeySource, McpServerConfig, Options } from "@anthropic-ai/claude-agent-sdk";
import { builtinToolName, mcpServerKey } from "../tools.js";

// Pure mapping from an AgentDefinition to Agent SDK options, kept free of I/O so it can be unit tested.

export const DEFAULT_MAX_TURNS = 25;

/** Name of the local plugin that carries an agent's skills into its step workspace. */
export const SKILLS_PLUGIN = "agentlab-skills";

/** Name of the in-process MCP server that hosts the app's function tools. */
export const FUNCTION_SERVER = "agentlab";

export interface ResolvedTools {
  /** Built-in Claude Code tools the agent can see (everything else is hidden). */
  builtins: string[];
  /** Permission rules for tools that run without asking. */
  allowedTools: string[];
  /** MCP server ids the agent needs connected. */
  mcpServerIds: string[];
  /** Function tool ids the agent needs from the in-process server. */
  functionToolIds: string[];
  /** Tool refs that could not be mapped, reported instead of silently dropped. */
  unknown: string[];
}

export function resolveTools(agent: AgentDefinition, knownFunctionIds: ReadonlySet<string>): ResolvedTools {
  const builtins = new Set<string>();
  const allowed = new Set<string>();
  const servers = new Set<string>();
  const functions = new Set<string>();
  const unknown: string[] = [];

  for (const ref of agent.tools ?? []) {
    const builtin = builtinToolName(ref);
    if (builtin) {
      builtins.add(builtin);
      allowed.add(builtin);
    } else if (ref.kind === "mcp" && ref.serverId) {
      servers.add(ref.serverId);
      const key = mcpServerKey(ref.serverId);
      allowed.add(ref.toolName ? `mcp__${key}__${ref.toolName}` : `mcp__${key}`);
    } else if (ref.kind === "function" && knownFunctionIds.has(ref.id)) {
      functions.add(ref.id);
      allowed.add(`mcp__${FUNCTION_SERVER}__${ref.id}`);
    } else {
      unknown.push(ref.name || ref.id);
    }
  }

  return {
    builtins: [...builtins],
    allowedTools: [...allowed],
    mcpServerIds: [...servers],
    functionToolIds: [...functions],
    unknown,
  };
}

/** Agent SDK MCP config for a registered server; the secret (if any) is resolved by the caller. */
export function toMcpConfig(server: McpServerDefinition, secret: string | undefined): McpServerConfig {
  if (server.transport.type === "http") {
    return {
      type: "http",
      url: server.transport.url,
      ...(secret ? { headers: { Authorization: `Bearer ${secret}` } } : {}),
    };
  }
  const env: Record<string, string> = {};
  if (secret && server.secretEnvVar) env[server.secretEnvVar] = secret;
  return { type: "stdio", command: server.transport.command, args: server.transport.args ?? [], env };
}

export function buildPrompt(input: unknown): string {
  if (typeof input === "string") return input;
  if (input === undefined || input === null) return "Start the task.";
  return `Input for this step:\n\n\`\`\`json\n${JSON.stringify(input, null, 2)}\n\`\`\``;
}

export function authSourceOf(apiKeySource: ApiKeySource | undefined): AuthSource {
  switch (apiKeySource) {
    case undefined:
      return "unknown";
    case "none":
    case "oauth":
      return "subscription";
    default:
      return "api-key";
  }
}

/**
 * Environment for the Claude Code subprocess. Variables from an enclosing Claude Code session
 * (when the app is started from one) would make the child think it is nested, so they are dropped;
 * CLAUDE_CODE_OAUTH_TOKEN is kept because it is how headless subscription auth works.
 */
export function childEnv(base: Record<string, string | undefined>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined) continue;
    if (key === "CLAUDECODE" || (key.startsWith("CLAUDE_CODE_") && key !== "CLAUDE_CODE_OAUTH_TOKEN")) continue;
    env[key] = value;
  }
  env.CLAUDE_AGENT_SDK_CLIENT_APP = "uptive-agentlab/0.0.1";
  return env;
}

/** Adaptive thinking exists on Claude 4.6 and later; Haiku 4.5 and older models reject it. */
export function supportsAdaptiveThinking(model: string): boolean {
  return !/haiku-4-5|-3-|claude-3|4-5-\d{8}|sonnet-4-5|opus-4-5|opus-4-1|opus-4-0|sonnet-4-0/.test(model);
}

export interface BaseOptionsInput {
  agent: AgentDefinition;
  tools: ResolvedTools;
  mcpServers: Record<string, McpServerConfig>;
  cwd: string;
  /** Folder of the step's skills plugin (see prepareWorkspace), when the agent has skills. */
  skillsPlugin?: string;
  additionalDirectories: string[];
  env: Record<string, string>;
  abortController: AbortController;
  defaultMaxTurns?: number;
  pathToClaudeCodeExecutable?: string;
}

/** Options shared by every run of an agent, minus hooks (added by the runtime). */
export function buildBaseOptions(input: BaseOptionsInput): Options {
  const { agent, tools } = input;
  const settings = agent.modelSettings ?? {};
  const maxTurns = typeof settings.maxTurns === "number" ? settings.maxTurns : (input.defaultMaxTurns ?? DEFAULT_MAX_TURNS);
  const effort = typeof settings.effort === "string" ? (settings.effort as Options["effort"]) : undefined;

  return {
    model: agent.model,
    systemPrompt: agent.systemInstructions,
    // `tools` is the complete set of built-in tools, so the Skill tool must be listed for skills to load.
    tools: agent.skills?.length ? [...tools.builtins, "Skill"] : tools.builtins,
    allowedTools: tools.allowedTools,
    // Anything not granted above is denied instead of prompting (there is no terminal to prompt in).
    permissionMode: "dontAsk",
    mcpServers: input.mcpServers,
    strictMcpConfig: true,
    // Isolation: no filesystem settings at all. "project" is not safe either: it walks up parent
    // folders, and a workspace under the home folder then picks up ~/.claude/CLAUDE.md. The agent's
    // skills come from a local plugin in the step workspace instead.
    settingSources: [],
    ...(input.skillsPlugin ? { plugins: [{ type: "local" as const, path: input.skillsPlugin, skipMcpDiscovery: true }] } : {}),
    skills: (agent.skills ?? []).map((name) => `${SKILLS_PLUGIN}:${name}`),
    persistSession: false,
    cwd: input.cwd,
    additionalDirectories: input.additionalDirectories,
    env: input.env,
    abortController: input.abortController,
    maxTurns,
    ...(effort ? { effort } : {}),
    // Token-level streaming for the live view, with readable thinking summaries. Without `display`,
    // Claude Code still thinks on older models (Haiku 4.5) but streams the blocks with empty text.
    // Older models keep Claude Code's default thinking budget.
    includePartialMessages: true,
    thinking: supportsAdaptiveThinking(agent.model) ? { type: "adaptive", display: "summarized" } : { type: "enabled", display: "summarized" },
    ...(agent.limits?.maxCostUsd ? { maxBudgetUsd: agent.limits.maxCostUsd } : {}),
    ...(agent.outputSchema && typeof agent.outputSchema === "object"
      ? { outputFormat: { type: "json_schema", schema: agent.outputSchema as Record<string, unknown> } }
      : {}),
    ...(input.pathToClaudeCodeExecutable ? { pathToClaudeCodeExecutable: input.pathToClaudeCodeExecutable } : {}),
  };
}

const FRIENDLY_ERRORS: Record<string, string> = {
  authentication_failed: "Claude rejected the login. Sign in with `claude` in a terminal, or set ANTHROPIC_API_KEY.",
  oauth_org_not_allowed: "This Claude account's organization does not allow this use.",
  billing_error: "Claude billing problem: check the subscription or API credit balance.",
  rate_limit: "Claude usage limit reached. With a subscription, wait for the limit window to reset.",
  overloaded: "Claude is overloaded right now; try again shortly.",
  model_not_found: "The agent's model does not exist or is not available to this account.",
  max_output_tokens: "The response hit the output token limit.",
};

export function friendlyError(code: string | undefined, fallback: string): string {
  return (code && FRIENDLY_ERRORS[code]) || fallback;
}

/** Final text output: parsed as JSON when it is JSON, so downstream steps get structured data. */
export function parseTextOutput(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/);
  const candidate = fenced ? fenced[1] : trimmed;
  if (candidate.startsWith("{") || candidate.startsWith("[")) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Not JSON after all; keep the text.
    }
  }
  return text;
}
