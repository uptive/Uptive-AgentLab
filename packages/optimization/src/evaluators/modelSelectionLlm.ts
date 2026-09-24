import type { Recommendation, RecommendationSeverity } from "@agentlab/contracts";
import { MODEL_CATALOG, getModel } from "../modelCatalog.js";
import { agentFor, modelCallAttempts } from "../helpers.js";
import type { EvaluationInput, Evaluator, ModelClient } from "../types.js";
import { TAG_INSTRUCTIONS, TAGS_SCHEMA, toTags } from "../tags.js";
import { excerpt, runTask } from "./llmFacts.js";
import { modelChangeImpact, modelSelectionEvaluator } from "./modelSelection.js";

const EVALUATOR_ID = "model-selection";

interface ModelFinding {
  nodeId: string;
  recommendedModel: string;
  problem: string;
  suggestion: string;
  severity: RecommendationSeverity;
  tags?: string[];
  evidence: string[];
}

export const MODEL_SELECTION_SYSTEM_PROMPT = `You review which model each agent in a multi-agent run uses. You are given the task, every step (the agent's role and instructions, its model, its measured tokens, cost, latency, retries and an excerpt of its output) and the catalog of models that may be used, with their tier and price.

For each step, judge whether its model fits the work the step actually does:
- Overpowered: a strong, expensive model on work a smaller model does just as well, such as planning, routing, extraction or formatting against a schema.
- Underpowered: a small model on work that needs more judgment (open-ended review, reasoning over long input), especially when it needed retries, failed, or produced weak or unstructured output.

Report only steps where a different model from the catalog is clearly better; leave well-matched steps out. recommendedModel must be a model id from the catalog and different from the step's current model. Do not estimate cost or time savings; they are calculated separately. In problem and suggestion, name the concrete reason (for example the kind of work, the output size, or the retries). Cite the numbers you rely on in evidence.

${TAG_INSTRUCTIONS}`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["findings"],
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["nodeId", "recommendedModel", "problem", "suggestion", "severity", "tags", "evidence"],
        properties: {
          nodeId: { type: "string" },
          recommendedModel: { type: "string", enum: MODEL_CATALOG.map((m) => m.id) },
          problem: { type: "string" },
          suggestion: { type: "string" },
          severity: { type: "string", enum: ["high", "medium", "low"] },
          tags: TAGS_SCHEMA,
          evidence: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
};

export function buildModelSelectionFacts(input: EvaluationInput) {
  return {
    task: runTask(input),
    availableModels: MODEL_CATALOG.map(({ id, label, tier, inputUsdPerMTok, outputUsdPerMTok }) => ({ id, label, tier, inputUsdPerMTok, outputUsdPerMTok })),
    steps: input.run.steps.map((step) => {
      const agent = agentFor(input, step);
      const modelCalls = input.events?.filter((e) => e.type === "model_call" && e.stepRunId === step.id).map((e) => e.data) ?? [];
      return {
        nodeId: step.nodeId,
        agent: agent
          ? { name: agent.name, role: agent.role, systemInstructions: agent.systemInstructions, model: agent.model, hasOutputSchema: Boolean(agent.outputSchema) }
          : { id: step.agentId },
        status: step.status,
        usage: step.usage,
        attempts: modelCallAttempts(input, step),
        modelCalls,
        output: excerpt(step.output, 1500),
      };
    }),
  };
}

/** Model Selection judged by a model; falls back to the rule-based evaluator when the model is unavailable. */
export function createModelSelectionLlmEvaluator(client: ModelClient): Evaluator {
  return {
    id: EVALUATOR_ID,
    name: "Model Selection",
    category: "model-selection",
    fallback: modelSelectionEvaluator,
    async evaluate(input) {
      const response = (await client.generateJson({
        system: MODEL_SELECTION_SYSTEM_PROMPT,
        prompt: `Review the model choice for each step of this run.\n\n${JSON.stringify(buildModelSelectionFacts(input), null, 2)}`,
        schema: SCHEMA,
      })) as { findings?: ModelFinding[] };

      const recommendations = new Map<string, Recommendation>();
      for (const finding of response.findings ?? []) {
        const step = input.run.steps.find((s) => s.nodeId === finding.nodeId);
        const agent = step && agentFor(input, step);
        const current = agent && getModel(agent.model);
        const alternative = getModel(finding.recommendedModel);
        if (!step?.usage || !agent || !current || !alternative || alternative.id === current.id) {
          console.warn(`[model-selection] dropped finding for "${finding.nodeId}" → ${finding.recommendedModel}: unknown step, model or no change`);
          continue;
        }

        const change = modelChangeImpact(input, step, current, alternative);
        const id = `${EVALUATOR_ID}:${change.direction}:${step.nodeId}`;
        if (recommendations.has(id)) continue;
        recommendations.set(id, {
          id,
          evaluatorId: EVALUATOR_ID,
          category: "model-selection",
          // The model's tags, plus what the calculated impact shows (e.g. Cost when the price changes).
          tags: toTags(finding.tags ?? [], change.tags),
          title: `${agent.name} → ${alternative.label}`,
          severity: finding.severity,
          target: { kind: "node", nodeId: step.nodeId, agentId: agent.id },
          problem: finding.problem,
          suggestion: finding.suggestion,
          change: { type: "set-model", path: "model", before: current.id, after: alternative.id },
          estimatedImpact: change.estimatedImpact,
          evidence: [...finding.evidence, ...change.evidence],
        });
      }
      return [...recommendations.values()];
    },
  };
}
