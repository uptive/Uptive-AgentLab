import type { Recommendation, RecommendationChange, RecommendationSeverity } from "@agentlab/contracts";
import { inputMappingOf, parseSource, stepForNode } from "../helpers.js";
import type { EvaluationInput, Evaluator, ModelClient } from "../types.js";
import { TAG_INSTRUCTIONS, TAGS_SCHEMA, toTags } from "../tags.js";
import { excerpt, runTask } from "./llmFacts.js";
import { brokenHandoffRecommendations, qualityEvaluator, resolveOutputPath } from "./quality.js";

const EVALUATOR_ID = "quality";

type QualityCheck = "handoff" | "instructions" | "task-input" | "final-output";
type QualityChangeType = "add-output-schema" | "edit-instructions" | "edit-input-mapping" | "extend-run-input";

interface QualityFinding {
  check: QualityCheck;
  targetNodeId: string;
  consumerNodeId: string;
  field: string;
  title: string;
  problem: string;
  suggestion: string;
  severity: RecommendationSeverity;
  tags?: string[];
  evidence: string[];
  changeType: QualityChangeType;
  proposal: string;
  expectedEffect: string;
}

export const QUALITY_SYSTEM_PROMPT = `You review the quality of a completed multi-agent run. You do not redo the task; you judge how well the agents and the handoffs between them served it. You are given the task, every step (agent role, instructions, output schema, input mapping, full input and output) and every handoff: a field one step receives from another step's output, with the value that was actually passed.

Check for these problems:
1. handoff: a handoff is faulty. That includes a missing value, but also one with the wrong shape or type for what the receiving step needs, a value that is incomplete or truncated, one that drops or contradicts what the producing step actually found, and a receiving step whose output ignores what it was given. Set consumerNodeId and field to the receiving step and input field.
2. instructions: an agent's instructions or output schema are too unclear for its role, so its output is inconsistent, unstructured or incomplete.
3. task-input: the run's task is too thin for the agents to know what done means (no acceptance criteria, scope or bar).
4. final-output: the final output does not satisfy the task, for example it contradicts findings from earlier steps.

Only report problems the data supports, and quote the concrete values in evidence. Do not comment on model choice, token usage or how the flow is wired; other reviewers cover those. Returning no findings is fine. Report each problem once.

For each finding, targetNodeId is the step where the fix belongs (often the producing step for a handoff). Pick one changeType and give the exact proposal:
- add-output-schema: proposal is a JSON Schema (as a JSON string) for the target agent's output.
- edit-instructions: proposal is the complete rewritten system instructions for the target agent.
- edit-input-mapping: proposal is a JSON object (as a JSON string) mapping the target step's input fields to sources, using "$input.<field>" for the run input or "<nodeId>.<field>" for an upstream step's output (the step's whole output is "<nodeId>"). A step without an inputMapping receives the run input when it has no dependencies, its single dependency's output, or an object keyed by dependency node id.
- extend-run-input: proposal is a JSON object (as a JSON string) of fields to add to the run input.
For checks other than handoff, set consumerNodeId and field to "". Titles are short imperative headlines (at most 8 words). expectedEffect is one sentence on what improves.

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
        required: ["check", "targetNodeId", "consumerNodeId", "field", "title", "problem", "suggestion", "severity", "tags", "evidence", "changeType", "proposal", "expectedEffect"],
        properties: {
          check: { type: "string", enum: ["handoff", "instructions", "task-input", "final-output"] },
          targetNodeId: { type: "string" },
          consumerNodeId: { type: "string" },
          field: { type: "string" },
          title: { type: "string" },
          problem: { type: "string" },
          suggestion: { type: "string" },
          severity: { type: "string", enum: ["high", "medium", "low"] },
          tags: TAGS_SCHEMA,
          evidence: { type: "array", items: { type: "string" } },
          changeType: { type: "string", enum: ["add-output-schema", "edit-instructions", "edit-input-mapping", "extend-run-input"] },
          proposal: { type: "string" },
          expectedEffect: { type: "string" },
        },
      },
    },
  },
};

export function buildQualityFacts(input: EvaluationInput) {
  const handoffs = input.flow.nodes.flatMap((consumer) =>
    Object.entries(inputMappingOf(input, consumer)).flatMap(([field, source]) => {
      const resolved = resolveOutputPath(input, source);
      if (!resolved) return [];
      const passed = (stepForNode(input, consumer.id)?.input as Record<string, unknown> | undefined)?.[field];
      return [
        {
          consumerNodeId: consumer.id,
          field,
          source,
          producerNodeId: resolved.nodeId,
          valueInProducerOutput: excerpt(resolved.value ?? null, 3000),
          valuePassedToConsumer: excerpt(passed ?? null, 3000),
          missing: resolved.value === undefined || resolved.value === null,
        },
      ];
    }),
  );

  return {
    task: runTask(input),
    steps: input.flow.nodes.map((node) => {
      const agent = input.agents.find((a) => a.id === node.agentId);
      const step = stepForNode(input, node.id);
      return {
        nodeId: node.id,
        agent: agent
          ? { name: agent.name, role: agent.role, systemInstructions: agent.systemInstructions, outputSchema: agent.outputSchema ?? null }
          : { id: node.agentId },
        dependsOn: node.dependsOn,
        inputMapping: inputMappingOf(input, node),
        explicitInputMapping: Boolean(node.inputMapping),
        status: step?.status ?? "not run",
        input: excerpt(step?.input ?? null, 6000),
        output: excerpt(step?.output ?? null, 4000),
      };
    }),
    handoffs,
  };
}

function parseObject(text: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** Checks a model finding against the run and turns it into a Recommendation, or returns why it was dropped. */
export function toQualityRecommendation(input: EvaluationInput, finding: QualityFinding): Recommendation | string {
  const node = input.flow.nodes.find((n) => n.id === finding.targetNodeId);
  if (!node) return `unknown target node ${finding.targetNodeId}`;
  const agent = input.agents.find((a) => a.id === node.agentId);

  if (finding.check === "handoff") {
    const consumer = input.flow.nodes.find((n) => n.id === finding.consumerNodeId);
    if (!consumer || !inputMappingOf(input, consumer)[finding.field]) return `${finding.consumerNodeId}.${finding.field} is not a mapped input`;
  }

  let change: RecommendationChange;
  switch (finding.changeType) {
    case "add-output-schema": {
      const schema = parseObject(finding.proposal);
      if (!schema) return "proposed schema is not a JSON object";
      change = { type: "add-output-schema", path: "outputSchema", before: agent?.outputSchema ?? null, after: schema };
      break;
    }
    case "edit-instructions":
      if (!finding.proposal.trim()) return "empty instructions";
      change = { type: "edit-instructions", path: "systemInstructions", before: agent?.systemInstructions ?? null, after: finding.proposal.trim() };
      break;
    case "edit-input-mapping": {
      const mapping = parseObject(finding.proposal);
      const nodeIds = new Set(input.flow.nodes.map((n) => n.id));
      const valid =
        mapping &&
        Object.values(mapping).every(
          (source) => {
            if (typeof source !== "string") return false;
            const ref = parseSource(source);
            return ref.kind === "input" || nodeIds.has(ref.nodeId);
          },
        );
      if (!valid) return "proposed input mapping is not valid";
      change = { type: "edit-input-mapping", path: `nodes.${node.id}.inputMapping`, before: inputMappingOf(input, node), after: mapping };
      break;
    }
    case "extend-run-input": {
      const fields = parseObject(finding.proposal);
      if (!fields) return "proposed run input is not a JSON object";
      const task = runTask(input);
      change = { type: "extend-run-input", path: "$input", before: { task }, after: { task, ...fields } };
      break;
    }
    default:
      return `unknown change type ${finding.changeType}`;
  }

  const id =
    finding.check === "handoff"
      ? `${EVALUATOR_ID}:broken-handoff:${finding.consumerNodeId}:${finding.field}`
      : `${EVALUATOR_ID}:${finding.check}:${node.id}`;
  return {
    id,
    evaluatorId: EVALUATOR_ID,
    category: "quality",
    tags: toTags(finding.tags ?? []),
    title: finding.title,
    severity: finding.severity,
    target: { kind: "node", nodeId: node.id, agentId: node.agentId },
    problem: finding.problem,
    suggestion: finding.suggestion,
    change,
    estimatedImpact: { quality: { risk: finding.severity }, summary: finding.expectedEffect },
    evidence: finding.evidence,
  };
}

/**
 * Quality judged by a model. Handoffs whose field is missing outright are always reported, from the
 * rule-based check, even if the model misses them. Falls back to the rule-based evaluator when the
 * model is unavailable.
 */
export function createQualityLlmEvaluator(client: ModelClient): Evaluator {
  return {
    id: EVALUATOR_ID,
    name: "Quality",
    category: "quality",
    fallback: qualityEvaluator,
    async evaluate(input) {
      const response = (await client.generateJson({
        evaluatorId: EVALUATOR_ID,
        system: QUALITY_SYSTEM_PROMPT,
        prompt: `Review the quality of this run.\n\n${JSON.stringify(buildQualityFacts(input), null, 2)}`,
        schema: SCHEMA,
      })) as { findings?: QualityFinding[] };

      const recommendations = new Map<string, Recommendation>();
      for (const finding of response.findings ?? []) {
        const result = toQualityRecommendation(input, finding);
        if (typeof result === "string") console.warn(`[quality] dropped "${finding.title}": ${result}`);
        else if (!recommendations.has(result.id)) recommendations.set(result.id, result);
      }
      for (const missing of brokenHandoffRecommendations(input)) {
        if (!recommendations.has(missing.id)) recommendations.set(missing.id, missing);
      }
      return [...recommendations.values()];
    },
  };
}

