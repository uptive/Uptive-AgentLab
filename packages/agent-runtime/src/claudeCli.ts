import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentDefinition, AgentResult, AgentRunContext, AgentRuntime, Usage } from "@agentlab/contracts";

export interface CliExecResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
  cancelled?: boolean;
}

/** Runs `claude` with the given args, writing `input` to stdin. Injected so hosts control how processes start. */
export type CliExec = (args: string[], options: { input: string; cwd: string; timeoutMs?: number }) => Promise<CliExecResult>;

export interface ClaudeCliRuntimeOptions {
  exec: CliExec;
  /** Used for agents whose model is not a Claude model. When unset, such agents fail with a clear error. */
  fallbackModel?: string;
  /** Working directory for the CLI. Defaults to the OS temp directory, so no project CLAUDE.md is picked up. */
  cwd?: string;
  timeoutMs?: number;
}

/** Model ids and the CLI's aliases that the Claude CLI accepts. */
const CLAUDE_MODEL = /^(claude-|sonnet$|opus$|haiku$|fable$)/i;

/** Shape of `claude -p --output-format json` that the runtime reads. */
interface CliJsonResult {
  is_error?: boolean;
  subtype?: string;
  result?: string;
  structured_output?: unknown;
  total_cost_usd?: number;
  duration_ms?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

export function resolveClaudeModel(agent: AgentDefinition, fallbackModel?: string): string {
  if (CLAUDE_MODEL.test(agent.model)) return agent.model;
  if (fallbackModel) return fallbackModel;
  throw new Error(`Agent "${agent.name}" uses model "${agent.model}", which the Claude CLI cannot run`);
}

/**
 * CLI arguments for one agent call. The run is isolated from the user's own Claude Code setup
 * (settings, CLAUDE.md, MCP servers, built-in tools) so agents behave the same on every machine
 * and don't pay for context they don't use. Every value is single-line so it survives cmd.exe
 * on Windows; the prompt goes through stdin and the system prompt through a file.
 */
export function buildClaudeArgs(agent: AgentDefinition, options: { model: string; systemPromptFile: string }): string[] {
  const args = [
    "-p",
    "--output-format", "json",
    "--model", options.model,
    "--system-prompt-file", options.systemPromptFile,
    "--no-session-persistence",
    "--setting-sources", "",
    "--strict-mcp-config",
    "--tools", "",
  ];
  if (agent.outputSchema !== undefined) args.push("--json-schema", JSON.stringify(agent.outputSchema));
  if (agent.limits?.maxCostUsd !== undefined) args.push("--max-budget-usd", String(agent.limits.maxCostUsd));
  return args;
}

export function formatPrompt(input: unknown): string {
  if (typeof input === "string") return input;
  return JSON.stringify(input ?? null, null, 2);
}

/** Turns the CLI's JSON result into an AgentResult. */
export function parseClaudeResult(agent: AgentDefinition, exec: CliExecResult, elapsedMs: number): AgentResult {
  const failed = (error: string, usage: Usage = zeroUsage(elapsedMs)): AgentResult => ({
    agentId: agent.id,
    status: "failed",
    output: undefined,
    error,
    usage,
    toolCalls: [],
  });

  if (exec.cancelled) return failed("Cancelled");
  if (exec.timedOut) return failed("The Claude CLI did not finish in time");

  let json: CliJsonResult;
  try {
    json = JSON.parse(exec.stdout) as CliJsonResult;
  } catch {
    const detail = (exec.stderr || exec.stdout).trim().slice(0, 500);
    return failed(`Claude CLI exited with ${exec.exitCode}${detail ? `: ${detail}` : ""}`);
  }

  const u = json.usage ?? {};
  const usage: Usage = {
    // Cached prompt tokens are still input the model read; count them so runs compare fairly.
    inputTokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
    outputTokens: u.output_tokens ?? 0,
    estimatedCostUsd: json.total_cost_usd ?? 0,
    latencyMs: json.duration_ms ?? elapsedMs,
  };

  if (json.is_error || exec.exitCode !== 0) {
    return failed(json.result || json.subtype || `Claude CLI exited with ${exec.exitCode}`, usage);
  }

  let output: unknown = json.result ?? "";
  if (agent.outputSchema !== undefined) output = json.structured_output ?? tryParseJson(json.result) ?? output;
  return { agentId: agent.id, status: "completed", output, usage, toolCalls: [] };
}

/**
 * AgentRuntime backed by the local Claude Code CLI (`claude -p`). Uses whatever the user is
 * signed in with: a Claude subscription or an API key.
 *
 * Not supported yet: agent `tools` (the CLI runs with no tools) and `modelSettings`.
 */
export function createClaudeCliRuntime(options: ClaudeCliRuntimeOptions): AgentRuntime {
  return {
    async run(agent: AgentDefinition, input: unknown, _context: AgentRunContext): Promise<AgentResult> {
      const started = Date.now();
      let dir: string | undefined;
      try {
        const model = resolveClaudeModel(agent, options.fallbackModel);
        dir = await mkdtemp(path.join(os.tmpdir(), "agentlab-"));
        const systemPromptFile = path.join(dir, "system-prompt.md");
        await writeFile(systemPromptFile, agent.systemInstructions, "utf8");

        const result = await options.exec(buildClaudeArgs(agent, { model, systemPromptFile }), {
          input: formatPrompt(input),
          cwd: options.cwd ?? os.tmpdir(),
          timeoutMs: options.timeoutMs,
        });
        return parseClaudeResult(agent, result, Date.now() - started);
      } catch (error) {
        return {
          agentId: agent.id,
          status: "failed",
          output: undefined,
          error: (error as Error).message,
          usage: zeroUsage(Date.now() - started),
          toolCalls: [],
        };
      } finally {
        if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
      }
    },
  };
}

function zeroUsage(latencyMs: number): Usage {
  return { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, latencyMs };
}

function tryParseJson(text: string | undefined): unknown {
  if (!text) return undefined;
  const trimmed = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}
