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

/**
 * Attempts the step needed: 1 plus its failed model calls. Successful model_call events are turns of
 * the agent's tool-use loop, not retries, so they don't count.
 */
export function modelCallAttempts(input: EvaluationInput, step: StepRun): number {
  const failed =
    input.events?.filter((e) => {
      if (e.type !== "model_call" || e.stepRunId !== step.id) return false;
      const data = e.data as { outcome?: string; error?: unknown } | undefined;
      return data?.outcome === "error" || Boolean(data?.error);
    }).length ?? 0;
  return 1 + failed;
}

/** Measured latency of a step: from usage, else from timestamps. */
export function stepLatencyMs(step: StepRun): number {
  if (step.usage) return step.usage.latencyMs;
  if (step.startedAt && step.completedAt) return Date.parse(step.completedAt) - Date.parse(step.startedAt);
  return 0;
}

/**
 * Start/end of every node when each starts as soon as its dependencies finish, using each step's
 * measured latency with optional per-node latency changes and re-wired dependencies applied.
 */
export function scheduleMs(
  input: EvaluationInput,
  stepDeltaMs: Map<string, number> = new Map(),
  dependsOnOverrides: Map<string, string[]> = new Map(),
): Map<string, { startMs: number; endMs: number }> {
  const schedule = new Map<string, { startMs: number; endMs: number }>();
  const endOf = (nodeId: string): number => {
    const cached = schedule.get(nodeId);
    if (cached) return cached.endMs;
    const node = input.flow.nodes.find((n) => n.id === nodeId);
    const step = stepForNode(input, nodeId);
    const base = step ? stepLatencyMs(step) : 0;
    const own = Math.max(base + (stepDeltaMs.get(nodeId) ?? 0), base * 0.1);
    const deps = dependsOnOverrides.get(nodeId) ?? node?.dependsOn ?? [];
    const startMs = Math.max(0, ...deps.map(endOf));
    schedule.set(nodeId, { startMs, endMs: startMs + own });
    return startMs + own;
  };
  input.flow.nodes.forEach((n) => endOf(n.id));
  return schedule;
}

/** Longest path through the flow. Parallel branches only count once: the slowest one sets the pace. */
export function criticalPathMs(
  input: EvaluationInput,
  stepDeltaMs: Map<string, number> = new Map(),
  dependsOnOverrides: Map<string, string[]> = new Map(),
): number {
  return Math.max(0, ...[...scheduleMs(input, stepDeltaMs, dependsOnOverrides).values()].map((t) => t.endMs));
}

/**
 * A reference in an input mapping, in the flow engine's format: "$input" / "$input.<path>" for the
 * run input, "<nodeId>" / "<nodeId>.<path>" for an upstream node's output.
 */
export type SourceRef = { kind: "input"; path: string[] } | { kind: "node"; nodeId: string; path: string[] };

export function parseSource(source: string): SourceRef {
  const [root, ...path] = source.split(".");
  return root === "$input" ? { kind: "input", path } : { kind: "node", nodeId: root, path };
}

/**
 * The node's input mapping. Nodes without an explicit one get the mapping the flow engine applies
 * (see `buildNodeInput` in @agentlab/flow-engine): no dependencies → the run input, one dependency →
 * that node's output, several → `{ [depNodeId]: output }`. Field names come from the recorded input.
 */
export function inputMappingOf(input: EvaluationInput, node: FlowNode): Record<string, string> {
  if (node.inputMapping) return node.inputMapping;
  if (node.dependsOn.length > 1) return Object.fromEntries(node.dependsOn.map((dep) => [dep, dep]));
  const received = stepForNode(input, node.id)?.input;
  const fields = received && typeof received === "object" && !Array.isArray(received) ? Object.keys(received) : [];
  const root = node.dependsOn.length === 1 ? node.dependsOn[0] : "$input";
  return fields.length ? Object.fromEntries(fields.map((field) => [field, `${root}.${field}`])) : { input: root };
}

/** Upstream node ids whose output this node actually reads through its input mapping. */
export function consumedNodeOutputs(input: EvaluationInput, node: FlowNode): string[] {
  const nodeIds = new Set(input.flow.nodes.map((n) => n.id));
  const ids = Object.values(inputMappingOf(input, node)).flatMap((source) => {
    const ref = parseSource(source);
    return ref.kind === "node" && nodeIds.has(ref.nodeId) ? [ref.nodeId] : [];
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
