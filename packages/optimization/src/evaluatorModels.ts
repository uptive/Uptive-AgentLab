/** Models the model-backed evaluators can run on, as offered in the Optimize view. */
export interface EvaluatorModel {
  id: string;
  label: string;
  /** One line on when to pick it. */
  note: string;
}

export const EVALUATOR_MODELS: EvaluatorModel[] = [
  { id: "claude-sonnet-5", label: "Sonnet 5", note: "Balanced speed and judgment" },
  { id: "claude-opus-5-5", label: "Opus 5.5", note: "Most thorough, slower, uses more of your plan" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5", note: "Smallest model, may miss subtler issues" },
];

export const DEFAULT_EVALUATOR_MODEL = "claude-sonnet-5";
