import type {
  CategorySummary,
  EvaluationResult,
  EvaluationSummary,
  Recommendation,
  RecommendationCategory,
  RecommendationSeverity,
  SkippedEvaluator,
} from "@agentlab/contracts";
import { flowDesignEvaluator } from "./evaluators/flowDesign.js";
import { modelSelectionEvaluator } from "./evaluators/modelSelection.js";
import { qualityEvaluator } from "./evaluators/quality.js";
import { tokenContextEvaluator } from "./evaluators/tokenContext.js";
import { criticalPathMs, totalRunCostUsd } from "./helpers.js";
import type { EvaluationInput, Evaluator } from "./types.js";

export const defaultEvaluators: Evaluator[] = [qualityEvaluator, modelSelectionEvaluator, tokenContextEvaluator, flowDesignEvaluator];

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
 * first. An evaluator that fails (e.g. no model access) is reported in `skippedEvaluators`.
 */
export async function analyzeRun(input: EvaluationInput, evaluators: Evaluator[] = defaultEvaluators): Promise<EvaluationResult> {
  const settled = await Promise.allSettled(evaluators.map((evaluator) => evaluator.evaluate(input)));
  const skippedEvaluators: SkippedEvaluator[] = [];
  const recommendations = settled
    .flatMap((result, i) => {
      if (result.status === "fulfilled") return result.value;
      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
      skippedEvaluators.push({ evaluatorId: evaluators[i].id, category: evaluators[i].category, reason });
      return [];
    })
    .sort(compareRecommendations);
  const createdAt = new Date().toISOString();
  return {
    id: `eval_${input.run.id}_${Date.parse(createdAt)}`,
    runId: input.run.id,
    flowId: input.flow.id,
    createdAt,
    evaluatorIds: evaluators.map((e) => e.id),
    skippedEvaluators,
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
  const baselineLatency = input.run.totalUsage?.latencyMs ?? criticalPathMs(input);
  const latencyDelta = criticalPathMs(input, stepDeltas, dependsOnOverrides) - criticalPathMs(input);
  return { costUsd, latencyMs: baselineLatency + Math.round(latencyDelta) };
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
    topRecommendationIds: [...recommendations].sort(compareRecommendations).slice(0, TOP_FIXES).map((r) => r.id),
  };
}
