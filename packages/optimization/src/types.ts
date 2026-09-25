import type {
  AgentDefinition,
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
