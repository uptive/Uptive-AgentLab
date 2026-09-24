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
 * The only thing LLM-backed evaluators need from a model. Implemented by the Anthropic SDK in
 * Node/Electron main (`@agentlab/optimization/anthropic`), by an IPC bridge in the renderer, and by
 * mocks in tests. Swap for Group 1's AgentRuntime once it can run evaluator agents.
 */
export interface ModelClient {
  generateJson(request: JsonRequest): Promise<unknown>;
}
