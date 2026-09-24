import type { EstimatedImpact, Recommendation, RecommendationTag, StepRun } from "@agentlab/contracts";
import { estimateCostUsd, getModel } from "../modelCatalog.js";
import {
  INPUT_MS_PER_1K_TOKENS,
  agentFor,
  agentName,
  conservativePercent,
  formatSeconds,
  formatTokens,
  inputFieldShares,
  isLightStructuredStep,
  speedImpact,
} from "../helpers.js";
import type { EvaluationInput, Evaluator } from "../types.js";

const EVALUATOR_ID = "token-context";
/** Run-level latency gains below this aren't worth reporting. */
const MIN_SPEED_GAIN_MS = 500;

export const tokenContextEvaluator: Evaluator = {
  id: EVALUATOR_ID,
  name: "Token & Context",
  category: "token-context",
  async evaluate(input) {
    return [...redundantFanInContext(input), ...oversizedPlanningInput(input)];
  },
};

/**
 * A fan-in node (e.g. a validator) receives raw content that every upstream branch already
 * processed, alongside those branches' outputs. It usually only needs the outputs.
 */
function redundantFanInContext(input: EvaluationInput): Recommendation[] {
  const recommendations: Recommendation[] = [];

  for (const node of input.flow.nodes) {
    if (node.dependsOn.length < 2 || !node.inputMapping) continue;
    const step = input.run.steps.find((s) => s.nodeId === node.id);
    const agent = step && agentFor(input, step);
    if (!step || !agent || !step.usage) continue;

    for (const { field, share } of inputFieldShares(step)) {
      const source = node.inputMapping[field];
      if (!source || share < 0.4) continue;

      const upstreamAlsoReceived = node.dependsOn.every((dep) => {
        const depNode = input.flow.nodes.find((n) => n.id === dep);
        return Object.values(depNode?.inputMapping ?? {}).includes(source);
      });
      const consumesUpstreamOutputs = node.dependsOn.some((dep) =>
        Object.values(node.inputMapping!).some((value) => value.startsWith(`${dep}.output`)),
      );
      if (!upstreamAlsoReceived || !consumesUpstreamOutputs) continue;

      const receivers = input.flow.nodes.filter((n) => Object.values(n.inputMapping ?? {}).includes(source));
      const upstreamNames = node.dependsOn.map((dep) => agentName(input, input.flow.nodes.find((n) => n.id === dep)!.agentId));
      const impact = contextImpact(input, step, agent.model, share);
      recommendations.push({
        id: `${EVALUATOR_ID}:redundant-fan-in:${node.id}:${field}`,
        evaluatorId: EVALUATOR_ID,
        title: `Drop \`${field}\` from ${agent.name}`,
        category: "token-context",
        tags: ["Context", "Input", "Duplication", ...impact.tags],
        severity: "medium",
        target: { kind: "node", nodeId: node.id, agentId: agent.id },
        problem: `${agent.name} receives the full \`${field}\` (~${Math.round(share * 100)}% of its input) even though ${upstreamNames.join(" and ")} already reviewed it and hand over their findings.`,
        suggestion: `Pass only the upstream findings. If ${agent.name} must verify a finding, pass just the referenced excerpts.`,
        change: { type: "remove-input", path: `inputMapping.${field}`, before: source, after: null },
        estimatedImpact: impact.estimatedImpact,
        evidence: [
          `\`${source}\` is sent to ${receivers.length} of ${input.flow.nodes.length} steps: ${receivers.map((n) => agentName(input, n.agentId)).join(", ")}.`,
          `${agent.name} input: ${formatTokens(step.usage.inputTokens)} tokens.`,
        ],
      });
    }
  }
  return recommendations;
}

/** A planning/routing step whose input is dominated by one large field while its output is tiny. */
function oversizedPlanningInput(input: EvaluationInput): Recommendation[] {
  const recommendations: Recommendation[] = [];

  for (const step of input.run.steps) {
    const agent = agentFor(input, step);
    const node = input.flow.nodes.find((n) => n.id === step.nodeId);
    if (!agent || !node || !step.usage || !isLightStructuredStep(agent, step)) continue;
    const ratio = step.usage.outputTokens / step.usage.inputTokens;
    const [dominant] = inputFieldShares(step);
    if (!dominant || ratio > 0.1 || dominant.share < 0.6) continue;

    const source = node.inputMapping?.[dominant.field] ?? dominant.field;
    const impact = contextImpact(input, step, agent.model, dominant.share);
    recommendations.push({
      id: `${EVALUATOR_ID}:oversized-planning-input:${step.nodeId}:${dominant.field}`,
      evaluatorId: EVALUATOR_ID,
      title: `Summarize ${agent.name}'s \`${dominant.field}\` input`,
      category: "token-context",
      tags: ["Context", "Input", ...impact.tags],
      severity: "medium",
      target: { kind: "node", nodeId: step.nodeId, agentId: agent.id },
      problem: `${agent.name} gets the full \`${dominant.field}\` (~${Math.round(dominant.share * 100)}% of its input) but only produces a short plan: input is ${Math.round(1 / ratio)}× its output.`,
      suggestion: `A plan only needs the changed files and their size (\`git diff --stat\`) plus the PR description. Downstream reviewers still get the full content.`,
      change: {
        type: "replace-input",
        path: `inputMapping.${dominant.field}`,
        before: source,
        after: `summary of ${source} (e.g. git diff --stat)`,
      },
      estimatedImpact: impact.estimatedImpact,
      evidence: [`${formatTokens(step.usage.inputTokens)} input tokens → ${formatTokens(step.usage.outputTokens)} output tokens.`],
    });
  }
  return recommendations;
}

/** Cost and speed effect of removing `removedShare` of a step's input tokens. */
function contextImpact(
  input: EvaluationInput,
  step: StepRun,
  modelId: string,
  removedShare: number,
): { estimatedImpact: EstimatedImpact; tags: RecommendationTag[] } {
  const usage = step.usage!;
  const tokensSaved = Math.round(usage.inputTokens * removedShare);
  const model = getModel(modelId);
  const stepCost = model ? estimateCostUsd(model, usage) : usage.estimatedCostUsd;
  const costPercent = model
    ? conservativePercent((1 - estimateCostUsd(model, { ...usage, inputTokens: usage.inputTokens - tokensSaved }) / stepCost) * 100)
    : 0;
  const speed = speedImpact(input, step.nodeId, -(tokensSaved / 1000) * INPUT_MS_PER_1K_TOKENS);
  const hasSpeed = -speed.latencyMs >= MIN_SPEED_GAIN_MS;

  return {
    tags: [...(costPercent > 0 ? (["Cost"] as const) : []), ...(hasSpeed ? (["Speed"] as const) : [])],
    estimatedImpact: {
      cost: { usdPerRun: -stepCost * (costPercent / 100), percent: -costPercent, inputTokensPerRun: -tokensSaved },
      ...(hasSpeed ? { speed } : {}),
      summary: `~${formatTokens(tokensSaved)} fewer input tokens per run, step cost −${costPercent}%${hasSpeed ? `, run ~${formatSeconds(-speed.latencyMs)} faster` : ""}`,
    },
  };
}
