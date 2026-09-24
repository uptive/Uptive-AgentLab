import type { EstimatedImpact, Recommendation, StepRun } from "@agentlab/contracts";
import { cheapestModelInTier, estimateCostUsd, getModel, type ModelInfo } from "../modelCatalog.js";
import {
  agentFor,
  conservativePercent,
  formatSeconds,
  formatUsd,
  isLightStructuredStep,
  modelCallAttempts,
  speedImpact,
  totalRunCostUsd,
} from "../helpers.js";
import type { EvaluationInput, Evaluator } from "../types.js";

const EVALUATOR_ID = "model-selection";
const TIER_RANK: Record<ModelInfo["tier"], number> = { fast: 0, balanced: 1, strong: 2 };

/** Rule-based: keyword/size heuristics. Also the fallback for the LLM-backed evaluator. */
export const modelSelectionEvaluator: Evaluator = {
  id: EVALUATOR_ID,
  name: "Model Selection",
  category: "model-selection",
  async evaluate(input) {
    return [...overpoweredModels(input), ...underpoweredModels(input)];
  },
};

export interface ModelChange {
  direction: "overpowered" | "underpowered";
  estimatedImpact: EstimatedImpact;
  evidence: string[];
  /** Share of the run's cost this change saves (negative when it costs more). */
  runCostShare: number;
}

/**
 * Cost, speed and reliability effect of moving a step from `current` to `alternative`, measured
 * from the step's recorded usage. A move to a stronger model assumes retries go away.
 */
export function modelChangeImpact(input: EvaluationInput, step: StepRun, current: ModelInfo, alternative: ModelInfo): ModelChange {
  const usage = step.usage!;
  const runCost = totalRunCostUsd(input);
  const currentCost = estimateCostUsd(current, usage);
  const attempts = modelCallAttempts(input, step);

  if (TIER_RANK[alternative.tier] < TIER_RANK[current.tier] || (TIER_RANK[alternative.tier] === TIER_RANK[current.tier] && attempts < 2)) {
    const alternativeCost = estimateCostUsd(alternative, usage);
    const reduction = conservativePercent((1 - alternativeCost / currentCost) * 100);
    const usdPerRun = -currentCost * (reduction / 100);
    return {
      direction: "overpowered",
      runCostShare: -usdPerRun / runCost,
      estimatedImpact: {
        ...(reduction > 0 ? { cost: { usdPerRun, percent: -reduction } } : {}),
        summary: reduction > 0 ? `Estimated cost reduction: ${reduction}%` : "About the same cost",
      },
      evidence: [
        `Step cost ${formatUsd(currentCost)} on ${current.id}; same tokens on ${alternative.id} ≈ ${formatUsd(alternativeCost)}.`,
        `This step is ${Math.round((currentCost / runCost) * 100)}% of the run's total cost (${formatUsd(runCost)}).`,
      ],
    };
  }

  const alternativeCost = estimateCostUsd(alternative, {
    inputTokens: usage.inputTokens / attempts,
    outputTokens: usage.outputTokens / attempts,
  });
  const costPercent = Math.round((alternativeCost / currentCost - 1) * 100);
  const costChanges = Math.abs(costPercent) >= 5;
  const retriesAvoided = attempts - 1;
  const speed = retriesAvoided > 0 ? speedImpact(input, step.nodeId, -(usage.latencyMs / attempts) * retriesAvoided) : undefined;
  const parts = [
    retriesAvoided > 0 ? `Removes ${retriesAvoided} retr${retriesAvoided === 1 ? "y" : "ies"}` : undefined,
    speed && speed.latencyMs < 0 ? `run ${formatSeconds(-speed.latencyMs)} faster` : undefined,
    costChanges ? `${costPercent > 0 ? "+" : ""}${costPercent}% step cost` : "about the same cost",
  ].filter(Boolean);

  return {
    direction: "underpowered",
    runCostShare: (currentCost - alternativeCost) / runCost,
    estimatedImpact: {
      ...(costChanges ? { cost: { usdPerRun: alternativeCost - currentCost, percent: costPercent } } : {}),
      ...(speed ? { speed } : {}),
      ...(retriesAvoided > 0 ? { reliability: { retriesAvoided } } : {}),
      quality: { risk: "medium" },
      summary: parts.join(", ").replace(/^./, (c) => c.toUpperCase()),
    },
    evidence: [
      ...(retriesAvoided > 0 ? [`${attempts} model calls recorded for this step in the trace.`] : []),
      ...(speed
        ? [
            `Step latency ${formatSeconds(usage.latencyMs)} → ~${formatSeconds(usage.latencyMs + speed.stepLatencyMs)}; the run gains ${formatSeconds(-speed.latencyMs)}.`,
          ]
        : []),
      `Current step cost ${formatUsd(currentCost)}; ${retriesAvoided > 0 ? "one attempt" : "same tokens"} on ${alternative.id} ≈ ${formatUsd(alternativeCost)}.`,
    ],
  };
}

/** Strong, expensive model used for a step that is mostly structured planning/routing. */
function overpoweredModels(input: EvaluationInput): Recommendation[] {
  const recommendations: Recommendation[] = [];

  for (const step of input.run.steps) {
    const agent = agentFor(input, step);
    const model = agent && getModel(agent.model);
    const alternative = cheapestModelInTier("fast");
    if (!agent || !model || !alternative || !step.usage || model.tier !== "strong") continue;
    if (!isLightStructuredStep(agent, step)) continue;

    const change = modelChangeImpact(input, step, model, alternative);
    if (!change.estimatedImpact.cost) continue;
    recommendations.push({
      id: `${EVALUATOR_ID}:overpowered:${step.nodeId}`,
      evaluatorId: EVALUATOR_ID,
      category: "model-selection",
      title: `${agent.name} → smaller model`,
      severity: change.runCostShare > 0.15 ? "high" : "medium",
      target: { kind: "node", nodeId: step.nodeId, agentId: agent.id },
      problem: `${agent.name} uses a strong and expensive model (${model.label}) even though the step is mainly structured planning.`,
      suggestion: `Try a smaller model. The step has an output schema and a short output, which ${alternative.label} handles well.`,
      change: { type: "set-model", path: "model", before: model.id, after: alternative.id },
      estimatedImpact: change.estimatedImpact,
      evidence: [`Output was ${step.usage.outputTokens.toLocaleString("en-US")} tokens against an output schema.`, ...change.evidence],
    });
  }
  return recommendations;
}

/** Fast/cheap model on a non-trivial step that needed retries. */
function underpoweredModels(input: EvaluationInput): Recommendation[] {
  const recommendations: Recommendation[] = [];

  for (const step of input.run.steps) {
    const agent = agentFor(input, step);
    const model = agent && getModel(agent.model);
    const alternative = cheapestModelInTier("balanced");
    if (!agent || !model || !alternative || !step.usage || model.tier !== "fast") continue;

    const attempts = modelCallAttempts(input, step);
    if (attempts < 2 || isLightStructuredStep(agent, step)) continue;

    const change = modelChangeImpact(input, step, model, alternative);
    recommendations.push({
      id: `${EVALUATOR_ID}:underpowered:${step.nodeId}`,
      evaluatorId: EVALUATOR_ID,
      category: "model-selection",
      title: `${agent.name} → stronger model`,
      severity: "medium",
      target: { kind: "node", nodeId: step.nodeId, agentId: agent.id },
      problem: `${agent.name} runs on a small model (${model.label}) for an open-ended review task and needed ${attempts} attempts.`,
      suggestion: `Retries multiply the tokens spent on the small model, so one call on ${alternative.label} is often no more expensive.`,
      change: { type: "set-model", path: "model", before: model.id, after: alternative.id },
      estimatedImpact: change.estimatedImpact,
      evidence: change.evidence,
    });
  }
  return recommendations;
}
