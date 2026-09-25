import type { EvaluationResult } from "@agentlab/contracts";
import { EVALUATOR_MODELS, type EvaluationInput } from "@agentlab/optimization";
import type { ModelCallRecord } from "./modelClient.js";

/** One analysis of a run with one model for the model-backed evaluators. */
export interface ModelAnalysis {
  modelId: string;
  evaluation?: EvaluationResult;
  error?: string;
  /** Every model call the evaluators made, with prompt, answer and usage. */
  calls: ModelCallRecord[];
  /** Wall-clock time of the whole analysis. */
  durationMs: number;
}

export const modelLabel = (modelId: string) => EVALUATOR_MODELS.find((m) => m.id === modelId)?.label ?? modelId;

export const EVALUATOR_LABELS: Record<string, string> = {
  quality: "Quality",
  "model-selection": "Model selection",
  "token-context": "Token & context",
  "flow-design": "Flow design",
};

/** Tokens, cost and model time of an analysis's model calls. */
export function analysisUsage(analysis: ModelAnalysis) {
  return analysis.calls.reduce(
    (sum, c) => ({
      inputTokens: sum.inputTokens + (c.usage?.inputTokens ?? 0),
      outputTokens: sum.outputTokens + (c.usage?.outputTokens ?? 0),
      costUsd: sum.costUsd + (c.usage?.costUsd ?? 0),
      hasCost: sum.hasCost || c.usage?.costUsd !== undefined,
    }),
    { inputTokens: 0, outputTokens: 0, costUsd: 0, hasCost: false },
  );
}

export function callSummary(call: ModelCallRecord): string {
  const u = call.usage;
  return [
    modelLabel(call.model),
    u ? `${u.inputTokens.toLocaleString("en-US")} in / ${u.outputTokens.toLocaleString("en-US")} out` : undefined,
    u?.costUsd !== undefined ? `$${u.costUsd.toFixed(4)}` : undefined,
    u?.durationMs ? `${(u.durationMs / 1000).toFixed(1)}s` : undefined,
    call.error ? "failed" : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}

const json = (value: unknown) => JSON.stringify(value, null, 2);

/** Everything the analysis saw and produced, as plain text for reading or saving. */
export function rawDataText(analysis: ModelAnalysis, input: EvaluationInput): string {
  const rule = (title: string) => `\n${"=".repeat(8)} ${title} ${"=".repeat(Math.max(4, 72 - title.length))}\n`;
  const parts = [
    `AgentLab analysis of "${input.flow.name}", run ${input.run.id}`,
    `Model-backed evaluators ran on ${modelLabel(analysis.modelId)}; analysis took ${(analysis.durationMs / 1000).toFixed(1)}s.`,
  ];
  for (const call of analysis.calls) {
    const name = EVALUATOR_LABELS[call.evaluatorId ?? ""] ?? call.evaluatorId ?? "Model call";
    parts.push(rule(`${name} · ${callSummary(call)}`));
    parts.push(call.error ? `Error: ${call.error}` : `--- Answer ---\n${json(call.response)}`);
    parts.push(`\n--- System prompt ---\n${call.system}`);
    parts.push(`\n--- Prompt ---\n${call.prompt}`);
  }
  if (analysis.evaluation) parts.push(rule("Full result, all evaluators"), json(analysis.evaluation));
  if (analysis.error) parts.push(rule("Error"), analysis.error);
  return parts.join("\n") + "\n";
}
