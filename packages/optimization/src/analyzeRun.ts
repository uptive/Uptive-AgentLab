import type {
  CategorySummary,
  EvaluationResult,
  EvaluationSummary,
  Recommendation,
  RecommendationCategory,
  RecommendationSeverity,
  SkippedEvaluator,
  StepTiming,
} from "@agentlab/contracts";
import { flowDesignEvaluator } from "./evaluators/flowDesign.js";
import { createModelSelectionLlmEvaluator } from "./evaluators/modelSelectionLlm.js";
import { createQualityLlmEvaluator } from "./evaluators/qualityLlm.js";
import { modelSelectionEvaluator } from "./evaluators/modelSelection.js";
import { qualityEvaluator } from "./evaluators/quality.js";
import { tokenContextEvaluator } from "./evaluators/tokenContext.js";
import { criticalPathMs, scheduleMs, totalRunCostUsd } from "./helpers.js";
import type { AnalyzeOptions, EvaluationInput, Evaluator, EvaluatorProgress, ModelClient } from "./types.js";

/** Rule-based evaluators; need no model. */
export const defaultEvaluators: Evaluator[] = [qualityEvaluator, modelSelectionEvaluator, tokenContextEvaluator, flowDesignEvaluator];

/**
 * Quality and Model Selection judged by a model through `client` (each falls back to its rules if
 * the model is unavailable); Token & Context and Flow Design stay rule-based.
 */
export function createEvaluators(client: ModelClient): Evaluator[] {
  return [createQualityLlmEvaluator(client), createModelSelectionLlmEvaluator(client), tokenContextEvaluator, flowDesignEvaluator];
}

export const CATEGORIES: RecommendationCategory[] = ["quality", "model-selection", "token-context", "flow-design"];

const SEVERITY_ORDER: Record<RecommendationSeverity, number> = { high: 0, medium: 1, low: 2 };
const TOP_FIXES = 3;

/** Priority order: severity, then quality risk addressed (correctness beats savings), then cost saved, then latency saved. */
export function compareRecommendations(a: Recommendation, b: Recommendation): number {
  const qualityRank = (r: Recommendation) => (r.estimatedImpact.quality ? SEVERITY_ORDER[r.estimatedImpact.quality.risk] : 3);
  return (
    SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
    qualityRank(a) - qualityRank(b) ||
    (a.estimatedImpact.cost?.usdPerRun ?? 0) - (b.estimatedImpact.cost?.usdPerRun ?? 0) ||
    (a.estimatedImpact.speed?.latencyMs ?? 0) - (b.estimatedImpact.speed?.latencyMs ?? 0)
  );
}

/**
 * Runs every evaluator over a completed run and merges their recommendations, highest priority
 * first. When a model-backed evaluator fails, its rule-based fallback runs instead
 * (`fallbackEvaluators`); an evaluator that can't run at all is listed in `skippedEvaluators`.
 */
export async function analyzeRun(
  input: EvaluationInput,
  evaluators: Evaluator[] = defaultEvaluators,
  options: AnalyzeOptions = {},
): Promise<EvaluationResult> {
  const skippedEvaluators: SkippedEvaluator[] = [];
  const fallbackEvaluators: SkippedEvaluator[] = [];
  const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

  const results = await Promise.all(
    evaluators.map(async (evaluator) => {
      const report = (update: Pick<EvaluatorProgress, "status" | "recommendations" | "reason">) =>
        options.onProgress?.({
          evaluatorId: evaluator.id,
          name: evaluator.name,
          category: evaluator.category,
          modelBacked: Boolean(evaluator.fallback),
          ...update,
        });
      report({ status: "running" });
      try {
        const recommendations = await evaluator.evaluate(input);
        report({ status: "done", recommendations: recommendations.length });
        return recommendations;
      } catch (error) {
        const entry = { evaluatorId: evaluator.id, category: evaluator.category, reason: reasonOf(error) };
        if (evaluator.fallback) {
          try {
            const recommendations = await evaluator.fallback.evaluate(input);
            fallbackEvaluators.push(entry);
            report({ status: "fallback", recommendations: recommendations.length, reason: entry.reason });
            return recommendations;
          } catch (fallbackError) {
            entry.reason = `${entry.reason}; fallback failed: ${reasonOf(fallbackError)}`;
          }
        }
        skippedEvaluators.push(entry);
        report({ status: "skipped", reason: entry.reason });
        return [];
      }
    }),
  );

  const recommendations = results.flat().sort(compareRecommendations);
  const createdAt = new Date().toISOString();
  return {
    id: `eval_${input.run.id}_${Date.parse(createdAt)}`,
    runId: input.run.id,
    flowId: input.flow.id,
    createdAt,
    evaluatorIds: evaluators.map((e) => e.id),
    skippedEvaluators,
    fallbackEvaluators,
    recommendations,
    summary: summarize(input, recommendations),
  };
}

function nodeIdOf(r: Recommendation): string | undefined {
  return r.target.kind === "node" ? r.target.nodeId : undefined;
}

/** Estimated run cost and latency if all `recommendations` are applied. */
function project(input: EvaluationInput, recommendations: Recommendation[]): { costUsd: number; latencyMs: number } {
  // Cost: savings on the same step compound (×0.3 then ×0.4 = ×0.12), savings on different steps add.
  let costUsd = 0;
  for (const step of input.run.steps) {
    const factor = recommendations
      .filter((r) => nodeIdOf(r) === step.nodeId && r.estimatedImpact.cost)
      .reduce((f, r) => f * Math.max(0, 1 + r.estimatedImpact.cost!.percent / 100), 1);
    costUsd += (step.usage?.estimatedCostUsd ?? 0) * factor;
  }

  // Latency: apply step-level changes and re-wired dependencies, then recompute the critical path.
  const { stepDeltas, dependsOnOverrides } = latencyChanges(recommendations);
  const baselineLatency = input.run.totalUsage?.latencyMs ?? criticalPathMs(input);
  const latencyDelta = criticalPathMs(input, stepDeltas, dependsOnOverrides) - criticalPathMs(input);
  return { costUsd, latencyMs: baselineLatency + Math.round(latencyDelta) };
}

/** Step latency changes and re-wired dependencies implied by a set of recommendations. */
function latencyChanges(recommendations: Recommendation[]) {
  const stepDeltas = new Map<string, number>();
  const dependsOnOverrides = new Map<string, string[]>();
  for (const r of recommendations) {
    const nodeId = nodeIdOf(r);
    if (nodeId && r.estimatedImpact.speed?.stepLatencyMs) {
      stepDeltas.set(nodeId, (stepDeltas.get(nodeId) ?? 0) + r.estimatedImpact.speed.stepLatencyMs);
    }
    if (nodeId && r.change.type === "set-dependencies" && Array.isArray(r.change.after)) {
      dependsOnOverrides.set(nodeId, r.change.after as string[]);
    }
  }
  return { stepDeltas, dependsOnOverrides };
}

/** Measured start/end of each step, next to where it would run with every recommendation applied. */
function timeline(input: EvaluationInput, recommendations: Recommendation[]): StepTiming[] {
  const { stepDeltas, dependsOnOverrides } = latencyChanges(recommendations);
  const projected = scheduleMs(input, stepDeltas, dependsOnOverrides);
  const modelled = scheduleMs(input);
  const runStart = Date.parse(input.run.startedAt);
  return input.flow.nodes.map((node) => {
    const step = input.run.steps.find((s) => s.nodeId === node.id);
    const measured =
      step?.startedAt && step.completedAt
        ? { startMs: Date.parse(step.startedAt) - runStart, endMs: Date.parse(step.completedAt) - runStart }
        : modelled.get(node.id)!;
    const p = projected.get(node.id)!;
    return { nodeId: node.id, measured, projected: { startMs: Math.round(p.startMs), endMs: Math.round(p.endMs) } };
  });
}

export function summarize(input: EvaluationInput, recommendations: Recommendation[]): EvaluationSummary {
  const baseline = { costUsd: totalRunCostUsd(input), latencyMs: input.run.totalUsage?.latencyMs ?? criticalPathMs(input) };

  const byCategory = Object.fromEntries(
    CATEGORIES.map((category): [RecommendationCategory, CategorySummary] => {
      const inCategory = recommendations.filter((r) => r.category === category);
      const projected = project(input, inCategory);
      return [
        category,
        {
          count: inCategory.length,
          highestSeverity: inCategory.map((r) => r.severity).sort((a, b) => SEVERITY_ORDER[a] - SEVERITY_ORDER[b])[0],
          usdPerRun: projected.costUsd - baseline.costUsd,
          latencyMs: projected.latencyMs - baseline.latencyMs,
        },
      ];
    }),
  ) as Record<RecommendationCategory, CategorySummary>;

  return {
    baseline,
    projected: project(input, recommendations),
    byCategory,
    timeline: timeline(input, recommendations),
    topRecommendationIds: [...recommendations].sort(compareRecommendations).slice(0, TOP_FIXES).map((r) => r.id),
  };
}
