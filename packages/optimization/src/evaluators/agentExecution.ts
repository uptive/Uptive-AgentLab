import type { AgentDefinition, EstimatedImpact, Recommendation, RecommendationTag, StepRun, TraceEvent } from "@agentlab/contracts";
import { getModel } from "../modelCatalog.js";
import { INPUT_MS_PER_1K_TOKENS, agentFor, conservativePercent, estimateTokens, formatSeconds, formatTokens, speedImpact } from "../helpers.js";
import type { EvaluationInput, Evaluator } from "../types.js";

const EVALUATOR_ID = "agent-execution";
/** Run-level latency gains below this aren't worth reporting. */
const MIN_SPEED_GAIN_MS = 500;
/** A tool's results must be re-read for at least this many tokens, and this share of the step's input, to report. */
const MIN_CARRIED_TOKENS = 10_000;
const MIN_CARRIED_SHARE = 0.25;
/** Reported when the agent spends at least this many turns only locating files. */
const MIN_DISCOVERY_TURNS = 3;
/** Cache pricing relative to the input price: the first re-read writes the cache, later ones read it. */
const CACHE_WRITE_FACTOR = 1.25;
const CACHE_READ_FACTOR = 0.1;

/** Tools that only locate things. Turns that use nothing else are spent finding files, not doing the task. */
const DISCOVERY_TOOLS = new Set(["Glob", "Grep", "LS", "ToolSearch"]);
const DISCOVERY_COMMAND = /^\s*(ls|find|tree|pwd|rg|grep|git (ls-files|status))\b/;

/**
 * Looks inside each agent's tool-use loop, using the step's model_call and tool_call trace events:
 * which tool results fill the context that every later turn re-reads, tool calls the agent repeated,
 * tool calls that failed, and turns spent only locating files.
 */
export const agentExecutionEvaluator: Evaluator = {
  id: EVALUATOR_ID,
  name: "Agent execution",
  category: "execution",
  async evaluate(input) {
    return input.run.steps.flatMap((step) => {
      const agent = agentFor(input, step);
      const trace = stepTrace(input.events ?? [], step);
      if (!agent || !step.usage || trace.turns.length < 2) return [];
      return [
        ...heavyToolResults(input, step, agent, trace),
        ...repeatedToolCalls(input, step, agent, trace),
        ...failingToolCalls(input, step, agent, trace),
        ...discoveryTurns(input, step, agent, trace),
      ];
    });
  },
};

interface Turn {
  inputTokens: number;
  /** Part of `inputTokens` served from the prompt cache. */
  cacheReadTokens: number;
  toolUses: string[];
}

interface TracedToolCall {
  toolId: string;
  input: unknown;
  status: "completed" | "failed";
  /** Estimated size of the result the agent read back. */
  outputTokens: number;
  error?: string;
  /** Index of the turn that asked for it; undefined when it can't be matched. */
  turn?: number;
}

interface StepTrace {
  turns: Turn[];
  toolCalls: TracedToolCall[];
}

/** The step's successful model calls in order, and its tool calls matched to the turn that made them. */
function stepTrace(events: TraceEvent[], step: StepRun): StepTrace {
  const own = events.filter((e) => e.stepRunId === step.id);
  const turns = own.flatMap((e) => (e.type === "model_call" ? parseTurn(e.data) : []));
  const toolCalls = own.flatMap((e) => (e.type === "tool_call" ? parseToolCall(e.data) : []));

  // Tool calls of one turn finish before that turn's model_call is recorded, so match by order:
  // each turn claims the next unmatched call of every tool it asked for.
  turns.forEach((turn, index) => {
    for (const name of turn.toolUses) {
      const call = toolCalls.find((c) => c.toolId === name && c.turn === undefined);
      if (call) call.turn = index;
    }
  });
  return { turns, toolCalls };
}

function parseTurn(data: unknown): Turn[] {
  if (!isRecord(data) || typeof data.inputTokens !== "number" || data.outcome === "error" || data.error) return [];
  const toolUses = Array.isArray(data.toolUses) ? data.toolUses.filter((t): t is string => typeof t === "string") : [];
  const cacheReadTokens = typeof data.cacheReadTokens === "number" ? Math.min(data.cacheReadTokens, data.inputTokens) : 0;
  return [{ inputTokens: data.inputTokens, cacheReadTokens, toolUses }];
}

function parseToolCall(data: unknown): TracedToolCall[] {
  if (!isRecord(data) || typeof data.toolId !== "string") return [];
  const failed = data.status === "failed";
  const error = failed && isRecord(data.output) && typeof data.output.error === "string" ? data.output.error : undefined;
  return [{ toolId: data.toolId, input: data.input, status: failed ? "failed" : "completed", outputTokens: resultTokens(data.output), error }];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Trace outputs are cut at 20k characters with a note of how much was dropped; count the full size. */
function resultTokens(output: unknown): number {
  const truncated = typeof output === "string" ? /\[truncated (\d+) characters\]$/.exec(output) : null;
  return estimateTokens(output) + (truncated ? Math.ceil(Number(truncated[1]) / 4) : 0);
}

/** Turns after the one that made `call`: each of them re-reads the call's result. */
function turnsAfter(trace: StepTrace, call: TracedToolCall): number {
  return call.turn === undefined ? 0 : trace.turns.length - 1 - call.turn;
}

function stepInputTokens(trace: StepTrace): number {
  return trace.turns.reduce((sum, t) => sum + t.inputTokens, 0);
}

/** A turn's input priced in full-price tokens: cached input costs a fraction of the input price. */
function turnCacheWeighted(turn: Turn): number {
  return turn.inputTokens - turn.cacheReadTokens + turn.cacheReadTokens * CACHE_READ_FACTOR;
}

function toolLabel(toolId: string): string {
  const mcp = /^mcp__(.+?)__(.+)$/.exec(toolId);
  return mcp ? `${mcp[2]} (${mcp[1]})` : toolId;
}

/**
 * Every tool result stays in the conversation, so each later turn re-reads it. A few large results
 * (whole files, long command output, full web pages) can make up most of a step's input tokens.
 */
function heavyToolResults(input: EvaluationInput, step: StepRun, agent: AgentDefinition, trace: StepTrace): Recommendation[] {
  const totalInput = stepInputTokens(trace);
  const byTool = new Map<string, { calls: number; resultTokens: number; carried: number; cacheWeighted: number }>();
  for (const call of trace.toolCalls) {
    const after = turnsAfter(trace, call);
    if (after === 0) continue;
    const entry = byTool.get(call.toolId) ?? { calls: 0, resultTokens: 0, carried: 0, cacheWeighted: 0 };
    entry.calls += 1;
    entry.resultTokens += call.outputTokens;
    entry.carried += call.outputTokens * after;
    entry.cacheWeighted += call.outputTokens * (CACHE_WRITE_FACTOR + CACHE_READ_FACTOR * (after - 1));
    byTool.set(call.toolId, entry);
  }

  return [...byTool.entries()].flatMap(([toolId, t]) => {
    const share = t.carried / totalInput;
    if (t.carried < MIN_CARRIED_TOKENS || share < MIN_CARRIED_SHARE) return [];
    const tool = toolLabel(toolId);
    const guidance = narrowingGuidance(toolId);
    const impact = executionImpact(input, step, agent, t.carried, t.cacheWeighted);
    return [
      {
        id: `${EVALUATOR_ID}:heavy-tool-results:${step.nodeId}:${toolId}`,
        evaluatorId: EVALUATOR_ID,
        title: `Narrow what ${agent.name} reads with ${tool}`,
        category: "execution",
        tags: ["Context", "Tools", ...impact.tags],
        severity: share >= 0.5 ? "high" : "medium",
        target: { kind: "node", nodeId: step.nodeId, agentId: agent.id },
        problem: `${tool} returned ~${formatTokens(t.resultTokens)} tokens over ${t.calls} call${t.calls === 1 ? "" : "s"}. Every later turn re-reads those results, which adds up to ~${formatTokens(t.carried)} input tokens, ${Math.round(share * 100)}% of everything ${agent.name} read in this step.`,
        suggestion: guidance,
        change: {
          type: "edit-instructions",
          path: "systemInstructions",
          before: agent.systemInstructions,
          after: withGuidance(agent, guidance),
        },
        estimatedImpact: impact.estimatedImpact,
        evidence: [
          `${agent.name} took ${trace.turns.length} turns; input per turn grew from ${formatTokens(trace.turns[0].inputTokens)} to ${formatTokens(trace.turns[trace.turns.length - 1].inputTokens)} tokens.`,
          `${tool}: ${t.calls} call${t.calls === 1 ? "" : "s"}, ~${formatTokens(t.resultTokens)} tokens of results.`,
        ],
      },
    ];
  });
}

function narrowingGuidance(toolId: string): string {
  if (toolId === "Read") return "Search with Grep before reading, and read only the line ranges you need (offset and limit) instead of whole files.";
  if (toolId === "Bash") return "Keep command output short: filter it (grep, head, --stat, --name-only) instead of printing everything.";
  if (toolId === "WebFetch") return "When fetching a page, ask only for the section you need instead of the whole page.";
  if (toolId.startsWith("mcp__")) return `Call ${toolLabel(toolId)} with filters, limits or pagination so it returns only the records you need.`;
  return `Ask ${toolLabel(toolId)} for only what the task needs, so its results stay small.`;
}

/** The agent made the same call with the same input more than once, and read the same result again. */
function repeatedToolCalls(input: EvaluationInput, step: StepRun, agent: AgentDefinition, trace: StepTrace): Recommendation[] {
  const seen = new Map<string, TracedToolCall>();
  const repeats: TracedToolCall[] = [];
  for (const call of trace.toolCalls) {
    if (call.status !== "completed") continue;
    const key = `${call.toolId}\u0000${JSON.stringify(call.input)}`;
    if (seen.has(key)) repeats.push(call);
    else seen.set(key, call);
  }
  if (repeats.length === 0) return [];

  const carried = repeats.reduce((sum, c) => sum + c.outputTokens * turnsAfter(trace, c), 0);
  const cacheWeighted = repeats.reduce((sum, c) => {
    const after = turnsAfter(trace, c);
    return sum + (after > 0 ? c.outputTokens * (CACHE_WRITE_FACTOR + CACHE_READ_FACTOR * (after - 1)) : 0);
  }, 0);
  const guidance = "Don't repeat a tool call you already made: reuse the earlier result from the conversation.";
  const impact = executionImpact(input, step, agent, carried, cacheWeighted);
  const examples = [...new Set(repeats.map((c) => `${toolLabel(c.toolId)} ${preview(c.input)}`))].slice(0, 3);
  return [
    {
      id: `${EVALUATOR_ID}:repeated-tool-calls:${step.nodeId}`,
      evaluatorId: EVALUATOR_ID,
      title: `Stop ${agent.name} repeating tool calls`,
      category: "execution",
      tags: ["Duplication", "Tools", ...impact.tags],
      severity: carried >= MIN_CARRIED_TOKENS ? "medium" : "low",
      target: { kind: "node", nodeId: step.nodeId, agentId: agent.id },
      problem: `${agent.name} made ${repeats.length} tool call${repeats.length === 1 ? "" : "s"} it had already made with the same input, and read the same result again.`,
      suggestion: guidance,
      change: { type: "edit-instructions", path: "systemInstructions", before: agent.systemInstructions, after: withGuidance(agent, guidance) },
      estimatedImpact: impact.estimatedImpact,
      evidence: examples.map((e) => `Repeated: ${e}`),
    },
  ];
}

/** Failed tool calls cost a turn each and leave their errors in the context. */
function failingToolCalls(input: EvaluationInput, step: StepRun, agent: AgentDefinition, trace: StepTrace): Recommendation[] {
  const failed = trace.toolCalls.filter((c) => c.status === "failed");
  if (failed.length < 2) return [];

  // Each failure makes the agent spend another turn; a turn costs about as much as the one that failed.
  const wastedTurns = failed.flatMap((c) => (c.turn === undefined ? [] : [trace.turns[c.turn]]));
  const wastedInput = wastedTurns.reduce((sum, t) => sum + t.inputTokens, 0);
  const impact = executionImpact(input, step, agent, wastedInput, wastedTurns.reduce((sum, t) => sum + turnCacheWeighted(t), 0));
  const errors = [...new Set(failed.map((c) => `${toolLabel(c.toolId)}: ${c.error ?? "failed"}`))].slice(0, 3);
  const tools = [...new Set(failed.map((c) => toolLabel(c.toolId)))];
  return [
    {
      id: `${EVALUATOR_ID}:failing-tool-calls:${step.nodeId}`,
      evaluatorId: EVALUATOR_ID,
      title: `Fix ${agent.name}'s failing tool calls`,
      category: "execution",
      tags: ["Error", "Tools", ...impact.tags],
      severity: failed.length / trace.toolCalls.length >= 0.3 ? "high" : "medium",
      target: { kind: "node", nodeId: step.nodeId, agentId: agent.id },
      problem: `${failed.length} of ${agent.name}'s ${trace.toolCalls.length} tool calls failed (${tools.join(", ")}). Each failure costs a turn that re-reads the whole conversation.`,
      suggestion: `Check the errors below. Usually the agent lacks a tool or permission, guesses paths or arguments, or needs an example of a correct call in its instructions.`,
      change: {
        type: "edit-instructions",
        path: "systemInstructions",
        before: agent.systemInstructions,
        after: withGuidance(agent, "Before calling a tool, check that paths exist and arguments match the tool's schema; don't guess them."),
      },
      estimatedImpact: { ...impact.estimatedImpact, reliability: { retriesAvoided: failed.length } },
      evidence: errors,
    },
  ];
}

/**
 * Turns that only locate files (Glob, Grep, ls, find…) before the agent gets to work. When the flow
 * already knows which files matter, passing them in the input saves those turns entirely.
 */
function discoveryTurns(input: EvaluationInput, step: StepRun, agent: AgentDefinition, trace: StepTrace): Recommendation[] {
  const discovery = trace.turns.flatMap((turn, index) => {
    const calls = trace.toolCalls.filter((c) => c.turn === index);
    return calls.length > 0 && calls.every(isDiscoveryCall) ? [index] : [];
  });
  if (discovery.length < MIN_DISCOVERY_TURNS) return [];

  const wastedInput = discovery.reduce((sum, i) => sum + trace.turns[i].inputTokens, 0);
  const impact = executionImpact(input, step, agent, wastedInput, discovery.reduce((sum, i) => sum + turnCacheWeighted(trace.turns[i]), 0));
  const guidance = "The files you need are listed in your input. Start from them instead of searching the workspace.";
  return [
    {
      id: `${EVALUATOR_ID}:discovery-turns:${step.nodeId}`,
      evaluatorId: EVALUATOR_ID,
      title: `Give ${agent.name} the files up front`,
      category: "execution",
      tags: ["Input", "Tools", ...impact.tags],
      severity: discovery.length / trace.turns.length >= 0.4 ? "medium" : "low",
      target: { kind: "node", nodeId: step.nodeId, agentId: agent.id },
      problem: `${discovery.length} of ${agent.name}'s ${trace.turns.length} turns only searched for files before it started on the task.`,
      suggestion: `If an earlier step or the run input knows which files matter, pass their paths to ${agent.name} and tell it to start from them.`,
      change: { type: "edit-instructions", path: "systemInstructions", before: agent.systemInstructions, after: withGuidance(agent, guidance) },
      estimatedImpact: impact.estimatedImpact,
      evidence: [`Search-only turns: ${discovery.map((i) => i + 1).join(", ")} (~${formatTokens(wastedInput)} input tokens).`],
    },
  ];
}

function isDiscoveryCall(call: TracedToolCall): boolean {
  if (DISCOVERY_TOOLS.has(call.toolId)) return true;
  return call.toolId === "Bash" && isRecord(call.input) && typeof call.input.command === "string" && DISCOVERY_COMMAND.test(call.input.command);
}

function preview(value: unknown): string {
  const text = JSON.stringify(value) ?? "";
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}

function withGuidance(agent: AgentDefinition, guidance: string): string {
  return `${agent.systemInstructions.trimEnd()}\n\n${guidance}`;
}

/**
 * Effect of not reading `tokensSaved` input tokens. `cacheWeightedTokens` prices them as the runtime
 * pays for them: re-read context is mostly served from the prompt cache at a fraction of the input price.
 */
function executionImpact(
  input: EvaluationInput,
  step: StepRun,
  agent: AgentDefinition,
  tokensSaved: number,
  cacheWeightedTokens: number,
): { estimatedImpact: EstimatedImpact; tags: RecommendationTag[] } {
  const stepCost = step.usage?.estimatedCostUsd ?? 0;
  const model = getModel(agent.model);
  const usdSaved = model ? Math.min(stepCost, (cacheWeightedTokens * model.inputUsdPerMTok) / 1_000_000) : 0;
  const costPercent = stepCost > 0 ? conservativePercent((usdSaved / stepCost) * 100) : 0;
  const speed = speedImpact(input, step.nodeId, -(cacheWeightedTokens / 1000) * INPUT_MS_PER_1K_TOKENS);
  const hasSpeed = -speed.latencyMs >= MIN_SPEED_GAIN_MS;

  return {
    tags: [...(costPercent > 0 ? (["Cost"] as const) : []), ...(hasSpeed ? (["Speed"] as const) : [])],
    estimatedImpact: {
      cost: { usdPerRun: -stepCost * (costPercent / 100), percent: -costPercent, inputTokensPerRun: -tokensSaved },
      ...(hasSpeed ? { speed } : {}),
      summary: `~${formatTokens(tokensSaved)} fewer input tokens per run${costPercent > 0 ? `, step cost −${costPercent}%` : ""}${hasSpeed ? `, run ~${formatSeconds(-speed.latencyMs)} faster` : ""}`,
    },
  };
}
