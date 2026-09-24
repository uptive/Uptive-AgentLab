import type { ModelId } from "./agent.js";
import type { Usage } from "./usage.js";

export type ModelTier = "strong" | "balanced" | "fast";

export interface ModelInfo {
  id: ModelId;
  label: string;
  tier: ModelTier;
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
}

// Models agents can choose from, with Anthropic first-party list prices (as of 2026-06).
// Shared by the agent editor, the runtime's token budget and the Optimize evaluators.
export const MODEL_CATALOG: ModelInfo[] = [
  { id: "claude-fable-5-1", label: "Claude Fable 5.1", tier: "strong", inputUsdPerMTok: 10, outputUsdPerMTok: 50 },
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", tier: "strong", inputUsdPerMTok: 4, outputUsdPerMTok: 20 },
  { id: "claude-opus-5", label: "Claude Opus 5", tier: "strong", inputUsdPerMTok: 5, outputUsdPerMTok: 25 },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5", tier: "balanced", inputUsdPerMTok: 2, outputUsdPerMTok: 10 },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", tier: "fast", inputUsdPerMTok: 1, outputUsdPerMTok: 5 },
];

export function getModel(id: ModelId): ModelInfo | undefined {
  return MODEL_CATALOG.find((model) => model.id === id);
}

export function cheapestModelInTier(tier: ModelTier): ModelInfo | undefined {
  return MODEL_CATALOG.filter((model) => model.tier === tier).sort(
    (a, b) => a.inputUsdPerMTok + a.outputUsdPerMTok - (b.inputUsdPerMTok + b.outputUsdPerMTok),
  )[0];
}

export function estimateCostUsd(model: ModelInfo, usage: Pick<Usage, "inputTokens" | "outputTokens">): number {
  return (usage.inputTokens * model.inputUsdPerMTok + usage.outputTokens * model.outputUsdPerMTok) / 1_000_000;
}
