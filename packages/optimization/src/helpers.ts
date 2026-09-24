import type { AgentDefinition, FlowNode, StepRun } from "@agentlab/contracts";
import type { EvaluationInput } from "./types.js";

/** Rough token estimate (~4 chars/token). Good enough for relative comparisons between inputs. */
export function estimateTokens(value: unknown): number {
  if (value === undefined || value === null) return 0;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return Math.ceil(text.length / 4);
}

/** Rounds a percentage down to the nearest 10 so estimates stay conservative. */
export function conservativePercent(percent: number): number {
  return Math.floor(percent / 10) * 10;
}

export function formatUsd(usd: number): string {
  return `$${usd.toFixed(4)}`;
}

export function formatTokens(tokens: number): string {
  return tokens.toLocaleString("en-US");
}

export function agentFor(input: EvaluationInput, step: StepRun): AgentDefinition | undefined {
  return input.agents.find((agent) => agent.id === step.agentId);
}

export function stepForNode(input: EvaluationInput, nodeId: string): StepRun | undefined {
  return input.run.steps.find((step) => step.nodeId === nodeId);
}

export function totalRunCostUsd(input: EvaluationInput): number {
  return input.run.totalUsage?.estimatedCostUsd ?? input.run.steps.reduce((sum, s) => sum + (s.usage?.estimatedCostUsd ?? 0), 0);
}

/** Top-level fields of a step's input, largest first, with their estimated token share of the whole input. */
export function inputFieldShares(step: StepRun): { field: string; tokens: number; share: number }[] {
  if (typeof step.input !== "object" || step.input === null) return [];
  const fields = Object.entries(step.input as Record<string, unknown>).map(([field, value]) => ({
    field,
    tokens: estimateTokens(value),
  }));
  const total = fields.reduce((sum, f) => sum + f.tokens, 0) || 1;
  return fields.map((f) => ({ ...f, share: f.tokens / total })).sort((a, b) => b.tokens - a.tokens);
}

/** All transitive upstream node ids of `nodeId` in the flow. */
export function ancestorsOf(input: EvaluationInput, nodeId: string): Set<string> {
  const result = new Set<string>();
  const visit = (id: string) => {
    const node = input.flow.nodes.find((n) => n.id === id);
    for (const dep of node?.dependsOn ?? []) {
      if (!result.has(dep)) {
        result.add(dep);
        visit(dep);
      }
    }
  };
  visit(nodeId);
  return result;
}

export function agentName(input: EvaluationInput, agentId: string): string {
  return input.agents.find((a) => a.id === agentId)?.name ?? agentId;
}

const STRUCTURED_TASK_PATTERN = /\b(plan\w*|rout\w*|classif\w*|extract\w*|format\w*|split\w*|list\w*)\b/i;

/**
 * A step is "light structured work" when the agent has an output schema, its role reads like
 * planning/routing/extraction, and it produced a small output. Such steps rarely need a strong model.
 */
export function isLightStructuredStep(agent: AgentDefinition, step: StepRun): boolean {
  const describesStructuredTask = STRUCTURED_TASK_PATTERN.test(`${agent.role} ${agent.name}`);
  return Boolean(agent.outputSchema) && describesStructuredTask && (step.usage?.outputTokens ?? Infinity) < 1_000;
}

/** Number of model calls recorded for a step (1 when no trace events are available). */
export function modelCallAttempts(input: EvaluationInput, step: StepRun): number {
  const calls = input.events?.filter((e) => e.type === "model_call" && e.stepRunId === step.id).length ?? 0;
  return Math.max(calls, 1);
}

/** Measured latency of a step: from usage, else from timestamps. */
export function stepLatencyMs(step: StepRun): number {
  if (step.usage) return step.usage.latencyMs;
  if (step.startedAt && step.completedAt) return Date.parse(step.completedAt) - Date.parse(step.startedAt);
  return 0;
}

/**
 * Longest path through the flow using each step's latency, with optional per-node latency
 * changes and re-wired dependencies applied. Parallel branches only count once: the slowest one
 * sets the pace.
 */
export function criticalPathMs(
  input: EvaluationInput,
  stepDeltaMs: Map<string, number> = new Map(),
  dependsOnOverrides: Map<string, string[]> = new Map(),
): number {
  const finish = new Map<string, number>();
  const finishOf = (nodeId: string): number => {
    const cached = finish.get(nodeId);
    if (cached !== undefined) return cached;
    const node = input.flow.nodes.find((n) => n.id === nodeId);
    const step = stepForNode(input, nodeId);
    const base = step ? stepLatencyMs(step) : 0;
    const own = Math.max(base + (stepDeltaMs.get(nodeId) ?? 0), base * 0.1);
    const deps = dependsOnOverrides.get(nodeId) ?? node?.dependsOn ?? [];
    const value = Math.max(0, ...deps.map(finishOf)) + own;
    finish.set(nodeId, value);
    return value;
  };
  return Math.max(0, ...input.flow.nodes.map((n) => finishOf(n.id)));
}

/** Upstream node ids whose output this node actually reads through its input mapping. */
export function consumedNodeOutputs(node: FlowNode): string[] {
  const ids = Object.values(node.inputMapping ?? {}).flatMap((source) => {
    const match = /^([^.$]+)\.output(?:\.|$)/.exec(source);
    return match ? [match[1]] : [];
  });
  return [...new Set(ids)];
}

export function speedImpact(input: EvaluationInput, nodeId: string, stepDeltaMs: number): { latencyMs: number; stepLatencyMs: number } {
  const latencyMs = criticalPathMs(input, new Map([[nodeId, stepDeltaMs]])) - criticalPathMs(input);
  return { latencyMs: Math.round(latencyMs), stepLatencyMs: Math.round(stepDeltaMs) };
}

/**
 * Rough prefill cost of input tokens. Illustrative heuristic (~150 ms per 1k input tokens);
 * replace with measured time-to-first-token from traces when Group 3 records it.
 */
export const INPUT_MS_PER_1K_TOKENS = 150;

export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}
