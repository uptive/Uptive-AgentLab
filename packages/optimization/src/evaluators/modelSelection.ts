import type { Recommendation } from "@agentlab/contracts";
import { cheapestModelInTier, estimateCostUsd, getModel } from "../modelCatalog.js";
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

export const modelSelectionEvaluator: Evaluator = {
  id: EVALUATOR_ID,
  name: "Model Selection",
  category: "model-selection",
  async evaluate(input) {
    return [...overpoweredModels(input), ...underpoweredModels(input)];
  },
};

/** Strong, expensive model used for a step that is mostly structured planning/routing. */
function overpoweredModels(input: EvaluationInput): Recommendation[] {
  const runCost = totalRunCostUsd(input);
  const recommendations: Recommendation[] = [];

  for (const step of input.run.steps) {
    const agent = agentFor(input, step);
    const model = agent && getModel(agent.model);
    const alternative = cheapestModelInTier("fast");
    if (!agent || !model || !alternative || !step.usage || model.tier !== "strong") continue;
    if (!isLightStructuredStep(agent, step)) continue;

    const currentCost = estimateCostUsd(model, step.usage);
    const alternativeCost = estimateCostUsd(alternative, step.usage);
    const reduction = conservativePercent((1 - alternativeCost / currentCost) * 100);
    if (reduction <= 0) continue;

    const usdPerRun = -currentCost * (reduction / 100);
    recommendations.push({
      id: `${EVALUATOR_ID}:overpowered:${step.nodeId}`,
      evaluatorId: EVALUATOR_ID,
      title: `${agent.name} → smaller model`,
      category: "model-selection",
      severity: -usdPerRun / runCost > 0.15 ? "high" : "medium",
      target: { kind: "node", nodeId: step.nodeId, agentId: agent.id },
      problem: `${agent.name} uses a strong and expensive model (${model.label}) even though the step is mainly structured planning.`,
      suggestion: `Try a smaller model. The step has an output schema and a short output, which ${alternative.label} handles well.`,
      change: { type: "set-model", path: "model", before: model.id, after: alternative.id },
      estimatedImpact: {
        cost: { usdPerRun, percent: -reduction },
        summary: `Estimated cost reduction: ${reduction}%`,
      },
      evidence: [
        `Output was ${step.usage.outputTokens.toLocaleString("en-US")} tokens against an output schema.`,
        `Step cost ${formatUsd(currentCost)} on ${model.id}; same tokens on ${alternative.id} ≈ ${formatUsd(alternativeCost)}.`,
        `This step is ${Math.round((currentCost / runCost) * 100)}% of the run's total cost (${formatUsd(runCost)}).`,
      ],
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

    const currentCost = estimateCostUsd(model, step.usage);
    const alternativeCost = estimateCostUsd(alternative, {
      inputTokens: step.usage.inputTokens / attempts,
      outputTokens: step.usage.outputTokens / attempts,
    });
    const costPercent = Math.round((alternativeCost / currentCost - 1) * 100);
    const retriesAvoided = attempts - 1;
    const speed = speedImpact(input, step.nodeId, -(step.usage.latencyMs / attempts) * retriesAvoided);
    const costChanges = Math.abs(costPercent) >= 5;

    recommendations.push({
      id: `${EVALUATOR_ID}:underpowered:${step.nodeId}`,
      evaluatorId: EVALUATOR_ID,
      title: `${agent.name} → stronger model`,
      category: "model-selection",
      severity: "medium",
      target: { kind: "node", nodeId: step.nodeId, agentId: agent.id },
      problem: `${agent.name} runs on a small model (${model.label}) for an open-ended review task and needed ${attempts} attempts.`,
      suggestion: `Retries multiply the tokens spent on the small model, so one call on ${alternative.label} is often no more expensive.`,
      change: { type: "set-model", path: "model", before: model.id, after: alternative.id },
      estimatedImpact: {
        ...(costChanges ? { cost: { usdPerRun: alternativeCost - currentCost, percent: costPercent } } : {}),
        speed,
        reliability: { retriesAvoided },
        quality: { risk: "medium" },
        summary: `Removes ${retriesAvoided} retr${retriesAvoided === 1 ? "y" : "ies"}, run ${formatSeconds(-speed.latencyMs)} faster, ${
          costChanges ? `${costPercent > 0 ? "+" : ""}${costPercent}% step cost` : "about the same cost"
        }`,
      },
      evidence: [
        `${attempts} model calls recorded for this step in the trace.`,
        `Step latency ${formatSeconds(step.usage.latencyMs)} → ~${formatSeconds(step.usage.latencyMs + speed.stepLatencyMs)}; the run only gains ${formatSeconds(-speed.latencyMs)} because parallel steps still set the pace.`,
        `Current step cost ${formatUsd(currentCost)}; one attempt on ${alternative.id} ≈ ${formatUsd(alternativeCost)}.`,
      ],
    });
  }
  return recommendations;
}
