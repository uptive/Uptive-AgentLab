/** The kind of analysis that produced a recommendation. One evaluator per category. */
export type RecommendationCategory = "quality" | "model-selection" | "token-context" | "flow-design";

export type RecommendationSeverity = "high" | "medium" | "low";

/** What a recommendation points at. Prefer the most specific kind available. */
export type RecommendationTarget =
  | { kind: "node"; nodeId: string; agentId: string }
  | { kind: "agent"; agentId: string }
  | { kind: "flow"; flowId: string };

export type ChangeType =
  | "set-model"
  | "remove-input"
  | "replace-input"
  | "add-output-schema"
  | "edit-instructions"
  | "extend-run-input"
  | "set-dependencies"
  | "add-node"
  | "merge-nodes"
  | "edit-role";

/** A concrete, machine-readable edit to the recommendation's target. `null` means absent/removed. */
export interface RecommendationChange {
  type: ChangeType;
  /** Property of the agent/node/flow being changed, e.g. "model", "inputMapping.diff", "nodes.validate.dependsOn". */
  path: string;
  before: unknown;
  after: unknown;
}

/**
 * Estimated effect if the recommendation is applied on its own. Every part is optional;
 * negative numbers are reductions.
 */
export interface EstimatedImpact {
  cost?: {
    /** Change in the targeted step's cost, in USD per run. */
    usdPerRun: number;
    /** Change relative to the targeted step's cost. */
    percent: number;
    /** Change in input tokens per run, when the fix is about context size. */
    inputTokensPerRun?: number;
  };
  speed?: {
    /** Change in end-to-end run latency (critical path through the flow). */
    latencyMs: number;
    /** Change in the targeted step's own latency (0 when only the flow shape changes). */
    stepLatencyMs: number;
  };
  reliability?: { retriesAvoided: number };
  /** Size of the quality risk this recommendation addresses. */
  quality?: { risk: RecommendationSeverity };
  /** Human-readable estimate, e.g. "Estimated cost reduction: 70%". */
  summary: string;
}

export interface Recommendation {
  id: string;
  /** Id of the evaluator that produced this recommendation. */
  evaluatorId: string;
  category: RecommendationCategory;
  /** Short action-oriented headline, e.g. "Planner → smaller model". */
  title: string;
  severity: RecommendationSeverity;
  target: RecommendationTarget;
  problem: string;
  suggestion: string;
  change: RecommendationChange;
  estimatedImpact: EstimatedImpact;
  /** Concrete observations from the run that back up the recommendation. */
  evidence?: string[];
}

export interface CategorySummary {
  count: number;
  highestSeverity?: RecommendationSeverity;
  /** Run cost change if every recommendation in the category is applied (same-node savings compound). */
  usdPerRun?: number;
  /** End-to-end latency change if every recommendation in the category is applied. */
  latencyMs?: number;
}

export interface EvaluationSummary {
  baseline: { costUsd: number; latencyMs: number };
  /** Estimated run cost/latency with every recommendation applied. */
  projected: { costUsd: number; latencyMs: number };
  byCategory: Record<RecommendationCategory, CategorySummary>;
  /** Highest-priority recommendations: by severity, then quality risk, then cost saved, then latency saved. */
  topRecommendationIds: string[];
}

export interface SkippedEvaluator {
  evaluatorId: string;
  category: RecommendationCategory;
  reason: string;
}

export interface EvaluationResult {
  id: string;
  runId: string;
  flowId: string;
  createdAt: string;
  evaluatorIds: string[];
  /** Evaluators that could not run (e.g. no model access). Their categories are missing from the result. */
  skippedEvaluators: SkippedEvaluator[];
  recommendations: Recommendation[];
  summary: EvaluationSummary;
}
