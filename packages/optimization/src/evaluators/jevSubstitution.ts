import type { Recommendation } from "@agentlab/contracts";
import { estimateCostUsd, estimateJevCostUsd, getModel } from "../modelCatalog.js";
import { agentFor, conservativePercent, formatUsd, hasLightOutput, totalRunCostUsd, writeToolCalls } from "../helpers.js";
import type { EvaluationInput, Evaluator } from "../types.js";

const EVALUATOR_ID = "jev-substitution";

/** Share of the output schema's fields that must be answerable as a typed decision. */
const DECISION_FIELD_SHARE = 0.6;

type JsonSchema = { type?: unknown; enum?: unknown; properties?: Record<string, unknown> };

const asSchema = (value: unknown): JsonSchema | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as JsonSchema) : undefined;

/** A field Jev can answer: a choice (enum), a noul (boolean) or a score (number). Never free text or lists. */
function isDecisionField(schema: JsonSchema): boolean {
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return true;
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  return type === "boolean" || type === "number" || type === "integer";
}

interface SchemaProfile {
  decisionFields: string[];
  totalFields: number;
  /** A choice or yes/no field, which is what makes the schema a verdict rather than a short report. */
  hasVerdictField: boolean;
}

/** Which fields of an agent's output schema read as typed decisions. */
export function decisionSchemaProfile(outputSchema: unknown): SchemaProfile | undefined {
  const properties = asSchema(outputSchema)?.properties;
  if (!properties) return undefined;
  const fields = Object.entries(properties).flatMap(([name, value]) => {
    const schema = asSchema(value);
    return schema ? [[name, schema] as const] : [];
  });
  if (fields.length === 0) return undefined;
  const decisions = fields.filter(([, schema]) => isDecisionField(schema));
  return {
    decisionFields: decisions.map(([name]) => name),
    totalFields: fields.length,
    hasVerdictField: decisions.some(([, schema]) => Array.isArray(schema.enum) || schema.type === "boolean"),
  };
}

/**
 * Rule-based: a strong-tier Claude step that only judges — a decision-shaped output schema, a short
 * output and no writes — costs far more than the same judgement as a Jev agent.
 *
 * Skipped unless `capabilities.jevAvailable` says Jev can run on this computer; a recommendation the
 * user cannot follow is worse than none.
 */
export const jevSubstitutionEvaluator: Evaluator = {
  id: EVALUATOR_ID,
  name: "Jev Substitution",
  category: "model-selection",
  skipReason(input) {
    return input.capabilities?.jevAvailable ? undefined : "TypeSafe Jev is not configured on this computer";
  },
  async evaluate(input) {
    return jevCandidates(input);
  },
};

function jevCandidates(input: EvaluationInput): Recommendation[] {
  const recommendations: Recommendation[] = [];
  const runCost = totalRunCostUsd(input);

  for (const step of input.run.steps) {
    const agent = agentFor(input, step);
    if (!agent || agent.engine === "jev" || !step.usage) continue;
    const model = getModel(agent.model);
    if (!model || model.tier !== "strong") continue;
    if (!hasLightOutput(step) || writeToolCalls(step).length > 0) continue;

    const profile = decisionSchemaProfile(agent.outputSchema);
    if (!profile?.hasVerdictField || profile.decisionFields.length / profile.totalFields < DECISION_FIELD_SHARE) continue;

    const currentCost = estimateCostUsd(model, step.usage);
    const jevCost = estimateJevCostUsd(step.usage);
    const reduction = conservativePercent((1 - jevCost / currentCost) * 100);
    if (reduction <= 0) continue;
    const usdPerRun = -currentCost * (reduction / 100);
    const runCostShare = -usdPerRun / runCost;

    recommendations.push({
      id: `${EVALUATOR_ID}:${step.nodeId}`,
      evaluatorId: EVALUATOR_ID,
      category: "model-selection",
      tags: ["Cost", "Validation"],
      title: `${agent.name} → Jev agent`,
      severity: runCostShare > 0.15 ? "high" : "medium",
      target: { kind: "node", nodeId: step.nodeId, agentId: agent.id },
      problem: `${agent.name} runs on ${model.label} to produce a typed verdict (${profile.decisionFields.join(", ")}), which is a decision rather than written text.`,
      suggestion: `Move this step to a Jev agent with one typed question per output field. Jev answers against a schema, so the verdict is valid by construction and is billed on the state it reads only.`,
      change: { type: "set-engine", path: "engine", before: agent.engine ?? "claude", after: "jev" },
      estimatedImpact: {
        cost: { usdPerRun, percent: -reduction },
        summary: `Estimated cost reduction: ${reduction}%`,
      },
      evidence: [
        `${profile.decisionFields.length} of ${profile.totalFields} output fields are enums, booleans or scores: ${profile.decisionFields.join(", ")}.`,
        `Output was ${step.usage.outputTokens.toLocaleString("en-US")} tokens, and the step made no file or shell writes.`,
        `Step cost ${formatUsd(currentCost)} on ${model.id}; the same ${step.usage.inputTokens.toLocaleString("en-US")} input tokens on Jev ≈ ${formatUsd(jevCost)}.`,
        `This step is ${Math.round((currentCost / runCost) * 100)}% of the run's total cost (${formatUsd(runCost)}).`,
      ],
    });
  }
  return recommendations;
}
