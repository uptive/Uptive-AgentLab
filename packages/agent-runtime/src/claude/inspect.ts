import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { query as sdkQuery, type McpServerConfig, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AuthSource, McpServerDefinition } from "@agentlab/contracts";
import { childEnv, friendlyError, toMcpConfig } from "./options.js";
import { mcpServerKey } from "../tools.js";

// Control-channel helpers: they start Claude Code without sending a prompt, so they cost nothing.

export interface InspectOptions {
  env?: Record<string, string | undefined>;
  pathToClaudeCodeExecutable?: string;
  query?: typeof sdkQuery;
}

/** A prompt stream that never yields: the session stays idle and no model call is made. */
const idlePrompt: AsyncIterable<SDKUserMessage> = {
  [Symbol.asyncIterator]: () => ({ next: () => new Promise<IteratorResult<SDKUserMessage>>(() => {}) }),
};

async function withIdleSession<T>(
  options: InspectOptions,
  mcpServers: Record<string, McpServerConfig>,
  use: (q: ReturnType<typeof sdkQuery>) => Promise<T>,
): Promise<T> {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "agentlab-inspect-"));
  const q = (options.query ?? sdkQuery)({
    prompt: idlePrompt,
    options: {
      tools: [],
      settingSources: [],
      persistSession: false,
      strictMcpConfig: true,
      mcpServers,
      cwd,
      env: childEnv(options.env ?? process.env),
      ...(options.pathToClaudeCodeExecutable ? { pathToClaudeCodeExecutable: options.pathToClaudeCodeExecutable } : {}),
    },
  });
  try {
    return await use(q);
  } finally {
    q.close();
    await fs.rm(cwd, { recursive: true, force: true }).catch(() => {});
  }
}

export interface ClaudeAuthStatus {
  source: AuthSource;
  /** Human-readable, e.g. "Claude Team subscription (leon@uptive.se)" or "API key". */
  label: string;
  email?: string;
  organization?: string;
  error?: string;
}

export async function getClaudeAuthStatus(options: InspectOptions = {}): Promise<ClaudeAuthStatus> {
  const env = options.env ?? process.env;
  try {
    const account = await withIdleSession(options, {}, (q) => q.accountInfo());
    if (env.ANTHROPIC_API_KEY || account.apiKeySource === "ANTHROPIC_API_KEY") {
      return { source: "api-key", label: "API key (billed per token)", organization: account.organization };
    }
    if (account.subscriptionType) {
      return {
        source: "subscription",
        label: `${account.subscriptionType} subscription${account.email ? ` (${account.email})` : ""}`,
        email: account.email,
        organization: account.organization,
      };
    }
    if (account.apiKeySource && account.apiKeySource !== "none") return { source: "api-key", label: "API key", organization: account.organization };
    return { source: "unknown", label: "Not signed in", error: "Run `claude` in a terminal and sign in, or set ANTHROPIC_API_KEY." };
  } catch (error) {
    return { source: "unknown", label: "Claude Code unavailable", error: error instanceof Error ? error.message : String(error) };
  }
}

export interface McpTestResult {
  status: "connected" | "failed" | "needs-auth" | "timeout";
  serverName?: string;
  tools: { name: string; description?: string; readOnly?: boolean; destructive?: boolean }[];
  error?: string;
}

/** Connects to an MCP server the way an agent would and lists its tools. */
export async function testMcpServer(
  server: McpServerDefinition,
  secret: string | undefined,
  options: InspectOptions & { timeoutMs?: number } = {},
): Promise<McpTestResult> {
  const key = mcpServerKey(server.id);
  const deadline = Date.now() + (options.timeoutMs ?? 30_000);
  try {
    return await withIdleSession(options, { [key]: toMcpConfig(server, secret) }, async (q) => {
      for (;;) {
        const status = (await q.mcpServerStatus()).find((s) => s.name === key);
        if (status && status.status !== "pending") {
          return {
            status: status.status === "connected" ? "connected" : status.status === "needs-auth" ? "needs-auth" : "failed",
            serverName: status.serverInfo?.name,
            tools: (status.tools ?? []).map((t) => ({
              name: t.name,
              description: t.description,
              readOnly: t.annotations?.readOnly,
              destructive: t.annotations?.destructive,
            })),
            error:
              status.status === "needs-auth"
                ? "The server wants a sign-in (OAuth). Add an access token as the server's secret instead."
                : status.error,
          };
        }
        if (Date.now() > deadline) return { status: "timeout", tools: [], error: "The server did not answer within 30 seconds" };
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
    });
  } catch (error) {
    return { status: "failed", tools: [], error: error instanceof Error ? error.message : String(error) };
  }
}

export interface JsonRequest {
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
}

/**
 * One-shot structured JSON generation through Claude Code, so LLM-backed evaluators work with a
 * subscription login as well as an API key. Matches the optimization package's ModelClient shape.
 */
export function createClaudeCodeJsonClient(options: InspectOptions & { model?: string } = {}) {
  return {
    async generateJson({ system, prompt, schema }: JsonRequest): Promise<unknown> {
      const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "agentlab-json-"));
      let lastError: string | undefined;
      try {
        for await (const message of (options.query ?? sdkQuery)({
          prompt,
          options: {
            model: options.model ?? "claude-opus-5",
            systemPrompt: system,
            tools: [],
            settingSources: [],
            persistSession: false,
            strictMcpConfig: true,
            cwd,
            env: childEnv(options.env ?? process.env),
            maxTurns: 4,
            outputFormat: { type: "json_schema", schema },
            ...(options.pathToClaudeCodeExecutable ? { pathToClaudeCodeExecutable: options.pathToClaudeCodeExecutable } : {}),
          },
        })) {
          if (message.type === "assistant" && message.error) lastError = message.error;
          if (message.type !== "result") continue;
          if (message.subtype === "success" && !message.is_error && message.structured_output !== undefined) return message.structured_output;
          throw new Error(friendlyError(lastError, "errors" in message ? message.errors.join("; ") || message.subtype : "Claude did not return JSON"));
        }
        throw new Error(friendlyError(lastError, "Claude Code ended without a result"));
      } finally {
        await fs.rm(cwd, { recursive: true, force: true }).catch(() => {});
      }
    },
  };
}
