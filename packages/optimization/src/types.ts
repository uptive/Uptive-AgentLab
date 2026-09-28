import type {
  AgentDefinition,
  EvaluationResult,
  FlowDefinition,
  Recommendation,
  RecommendationCategory,
  Run,
  TraceEvent,
} from "@agentlab/contracts";

/** Everything an evaluator may look at. Evaluators critique the run; they never re-run the task. */
export interface EvaluationInput {
  run: Run;
  flow: FlowDefinition;
  agents: AgentDefinition[];
  events?: TraceEvent[];
}

export interface Evaluator {
  id: string;
  name: string;
  category: RecommendationCategory;
  evaluate(input: EvaluationInput): Promise<Recommendation[]>;
  /** Rule-based evaluator to run instead when this one fails (e.g. the model is unavailable). */
  fallback?: Evaluator;
}

/** Reported by analyzeRun as each evaluator starts and finishes. */
export interface EvaluatorProgress {
  evaluatorId: string;
  name: string;
  category: RecommendationCategory;
  /** True when the evaluator asks a model (and has a rule-based fallback). */
  modelBacked: boolean;
  status: "running" | "done" | "fallback" | "skipped";
  /** Recommendations produced, once finished. */
  recommendations?: number;
  /** Why the model-backed evaluator fell back or was skipped. */
  reason?: string;
}

export interface AnalyzeOptions {
  onProgress?: (progress: EvaluatorProgress) => void;
}

/** One structured-output model call: the response must be JSON matching `schema`. */
export interface JsonRequest {
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  /** Model id for this call. Backends fall back to $AGENT_MODEL, then DEFAULT_EVALUATOR_MODEL. */
  model?: string;
  /** Evaluator making the call, so its request and answer can be shown later. */
  evaluatorId?: string;
}

/** What one model call used. */
export interface ModelCallUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Cost at API list prices (also reported when the call ran on a subscription). */
  costUsd?: number;
  durationMs: number;
}

/** A structured-output answer together with what the call used. */
export interface JsonResponse {
  value: unknown;
  usage?: ModelCallUsage;
}

/**
 * What LLM-backed evaluators need from a model. Backends live in `@agentlab/optimization/models`
 * (Node only: Claude Code CLI or Anthropic API, picked by AGENT_BACKEND); the renderer reaches them
 * through the Electron IPC bridge (`apps/desktop/src/optimize/modelClient.ts`).
 */
export interface ModelClient {
  generateJson(request: JsonRequest): Promise<unknown>;
  /** Same call, also reporting tokens, cost and duration. Backends that can measure it implement this. */
  generateJsonWithUsage?(request: JsonRequest): Promise<JsonResponse>;
}

/** One model call made by an evaluator: what was asked, what came back, and what it used. */
export interface ModelCallRecord {
  evaluatorId?: string;
  model: string;
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  startedAt: string;
  /** The model's JSON answer, when the call succeeded. */
  response?: unknown;
  usage?: ModelCallUsage;
  error?: string;
}

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

/** The headline of a saved optimization, for the list of recent ones. */
export interface SavedOptimizationSummary {
  id: string;
  createdAt: string;
  runId: string;
  flowName: string;
  /** Models the analysis ran with, in the order picked. */
  modelIds: string[];
  recommendations: number;
  highSeverity: number;
  /** Estimated saving per run with every recommendation applied. */
  savedUsdPerRun: number;
  /** Recommendations whose changes were saved from this optimization. */
  applied: number;
}

/** A finished optimization, saved on this computer so it can be reopened later. */
export interface SavedOptimization {
  summary: SavedOptimizationSummary;
  /** What was analyzed, without trace events (the evaluators are done with them). */
  input: EvaluationInput;
  analyses: ModelAnalysis[];
  /** Model whose analysis is shown first. */
  analyzedWith: string;
  /** Cards whose changes were saved, and the user's own versions of suggested changes, by card key. */
  appliedKeys: string[];
  edits: [string, unknown][];
}
