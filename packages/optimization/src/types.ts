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
}

/** One structured-output model call: the response must be JSON matching `schema`. */
export interface JsonRequest {
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
}

/**
 * What LLM-backed evaluators will need from a model. Not used yet: all evaluators are rule-based for
 * now. Implemented by the Anthropic SDK in Node/Electron main (`@agentlab/optimization/anthropic`)
 * and by the IPC bridge in the renderer (`apps/desktop/src/optimize/modelClient.ts`).
 */
export interface ModelClient {
  generateJson(request: JsonRequest): Promise<unknown>;
}
