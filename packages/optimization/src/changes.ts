import type { AgentDefinition, FlowDefinition, FlowNode, Recommendation } from "@agentlab/contracts";
import { agentName, inputMappingOf, parseSource } from "./helpers.js";
import type { EvaluationInput } from "./types.js";

/** A field that a recommendation changes, on an agent, a flow step or the run input. */
export type EditTarget =
  | { kind: "agent"; agentId: string; name: string }
  | { kind: "node"; nodeId: string; name: string }
  | { kind: "run-input" };

export type EditField = "model" | "outputSchema" | "systemInstructions" | "role" | "inputMapping" | "dependsOn" | "input";

export interface PlannedEdit {
  recommendationId: string;
  target: EditTarget;
  field: EditField;
  /** Value in the analyzed run. */
  before: unknown;
  after: unknown;
}

/**
 * What testing (and later applying) a set of recommendations changes: edited copies of the run's
 * flow, agents and input, plus every field-level edit. The originals are never modified.
 */
export interface ChangePlan {
  flow: FlowDefinition;
  agents: AgentDefinition[];
  runInput: unknown;
  edits: PlannedEdit[];
  /** Selected recommendations that were left out, and why. */
  skipped: { recommendationId: string; reason: string }[];
}

export const FIELD_LABELS: Record<EditField, string> = {
  model: "Model",
  outputSchema: "Output schema",
  systemInstructions: "Instructions",
  role: "Role",
  inputMapping: "Inputs",
  dependsOn: "Runs after",
  input: "Run input",
};

/** Placeholders like `<what this step must check>` or `…` mark a suggestion a person still has to fill in. */
const PLACEHOLDER = /<[^<>\n]{3,80}>|…/;

const hasPlaceholder = (value: unknown) => PLACEHOLDER.test(typeof value === "string" ? value : JSON.stringify(value) ?? "");

/** Why a recommendation can't be tried automatically, or undefined when it can. */
export function notTestableReason(input: EvaluationInput, r: Recommendation): string | undefined {
  const { change } = r;
  const node = r.target.kind === "node" ? input.flow.nodes.find((n) => n.id === (r.target as { nodeId: string }).nodeId) : undefined;
  const agentId = r.target.kind === "flow" ? undefined : r.target.agentId;
  const agent = input.agents.find((a) => a.id === agentId);
  switch (change.type) {
    case "set-model":
    case "edit-role":
      return agent ? undefined : "the agent isn't part of this run";
    case "add-output-schema": {
      if (!agent) return "the agent isn't part of this run";
      const properties = (change.after as { properties?: Record<string, unknown> } | null)?.properties;
      return properties && Object.keys(properties).length > 0 ? undefined : "the suggested schema has no fields yet";
    }
    case "edit-instructions":
      if (!agent) return "the agent isn't part of this run";
      return hasPlaceholder(change.after) ? "the suggested instructions contain placeholders to fill in" : undefined;
    case "remove-input":
    case "set-dependencies":
      return node ? undefined : "the step isn't part of this flow";
    case "edit-input-mapping": {
      if (!node) return "the step isn't part of this flow";
      const deps = new Set(node.dependsOn);
      const sources = Object.values((change.after as Record<string, string>) ?? {});
      const outside = sources.map(parseSource).find((ref) => ref.kind === "node" && !deps.has(ref.nodeId));
      return outside?.kind === "node" ? `it reads from ${outside.nodeId}, which this step doesn't run after` : undefined;
    }
    case "extend-run-input":
      return hasPlaceholder(change.after) ? "the suggested input fields contain placeholders to fill in" : undefined;
    case "replace-input":
      return "it needs a new step that produces the summary";
    case "add-node":
      return "it needs a new agent for the new step";
    case "merge-nodes":
      return "merging steps needs a decision about which agent to keep";
  }
}

/** Target and field a recommendation edits, so two edits to the same field can be detected. */
function editKey(r: Recommendation): string {
  const { change, target } = r;
  const where = target.kind === "node" ? target.nodeId : target.kind === "agent" ? target.agentId : "flow";
  switch (change.type) {
    case "set-model":
    case "add-output-schema":
    case "edit-instructions":
    case "edit-role":
      return `agent:${target.kind === "flow" ? "" : target.agentId}:${change.type}`;
    case "extend-run-input":
      return "run-input";
    default:
      return `node:${where}:${change.type === "set-dependencies" ? "dependsOn" : "inputMapping"}`;
  }
}

/** Recommendations among `candidates` that edit the same field as `r` (only one of them can be tested at a time). */
export function conflictsWith(r: Recommendation, candidates: Recommendation[]): Recommendation[] {
  const key = editKey(r);
  return candidates.filter((c) => c.id !== r.id && editKey(c) === key);
}

/** Edited copies of the run's flow, agents and input with `recommendations` applied, in order. */
export function planChanges(input: EvaluationInput, recommendations: Recommendation[]): ChangePlan {
  const flow: FlowDefinition = structuredClone(input.flow);
  const agents: AgentDefinition[] = structuredClone(input.agents);
  let runInput: unknown = structuredClone(input.run.input ?? rootInput(input));
  const edits: PlannedEdit[] = [];
  const skipped: ChangePlan["skipped"] = [];
  const taken = new Set<string>();

  const agentTarget = (agent: AgentDefinition): EditTarget => ({ kind: "agent", agentId: agent.id, name: agent.name });
  const nodeTarget = (node: FlowNode): EditTarget => ({ kind: "node", nodeId: node.id, name: node.label ?? agentName(input, node.agentId) });
  // Nodes without an explicit mapping get their input implicitly from their dependencies. Pin that
  // mapping before editing inputs or dependencies, so the step keeps receiving the same fields.
  const pinMapping = (node: FlowNode) => (node.inputMapping ??= { ...inputMappingOf(input, input.flow.nodes.find((n) => n.id === node.id)!) });

  for (const r of recommendations) {
    const reason = notTestableReason(input, r) ?? (taken.has(editKey(r)) ? "another selected change edits the same field" : undefined);
    if (reason) {
      skipped.push({ recommendationId: r.id, reason });
      continue;
    }
    taken.add(editKey(r));
    const { change } = r;
    const agent = r.target.kind === "flow" ? undefined : agents.find((a) => a.id === (r.target as { agentId: string }).agentId);
    const node = r.target.kind === "node" ? flow.nodes.find((n) => n.id === (r.target as { nodeId: string }).nodeId) : undefined;

    const editAgent = (field: "model" | "outputSchema" | "systemInstructions" | "role", after: unknown) => {
      edits.push({ recommendationId: r.id, target: agentTarget(agent!), field, before: agent![field] ?? null, after });
      (agent as unknown as Record<string, unknown>)[field] = after;
    };
    // "Before" is always the step as it ran, read from the original flow (the copy may be edited already).
    const original = node && input.flow.nodes.find((n) => n.id === node.id)!;
    const editNode = (field: "inputMapping" | "dependsOn", after: unknown) => {
      const before = field === "dependsOn" ? [...original!.dependsOn] : { ...inputMappingOf(input, original!) };
      edits.push({ recommendationId: r.id, target: nodeTarget(node!), field, before, after });
    };

    switch (change.type) {
      case "set-model":
        editAgent("model", change.after);
        break;
      case "add-output-schema":
        editAgent("outputSchema", change.after);
        break;
      case "edit-instructions":
        editAgent("systemInstructions", change.after);
        break;
      case "edit-role":
        editAgent("role", change.after);
        break;
      case "remove-input": {
        const field = change.path.replace(/^inputMapping\./, "");
        const mapping = { ...pinMapping(node!) };
        delete mapping[field];
        node!.inputMapping = mapping;
        editNode("inputMapping", mapping);
        break;
      }
      case "edit-input-mapping":
        pinMapping(node!);
        node!.inputMapping = { ...(change.after as Record<string, string>) };
        editNode("inputMapping", node!.inputMapping);
        break;
      case "set-dependencies": {
        const mapping = pinMapping(node!);
        node!.dependsOn = [...(change.after as string[])];
        // Keep only mapped fields whose source still runs before this step.
        const deps = new Set(node!.dependsOn);
        node!.inputMapping = Object.fromEntries(
          Object.entries(mapping).filter(([, source]) => {
            const ref = parseSource(source);
            return ref.kind === "input" || deps.has(ref.nodeId);
          }),
        );
        editNode("dependsOn", node!.dependsOn);
        break;
      }
      case "extend-run-input": {
        const before = runInput;
        const added = (change.after as Record<string, unknown>) ?? {};
        runInput = { ...(typeof runInput === "object" && runInput ? runInput : {}), ...added };
        edits.push({ recommendationId: r.id, target: { kind: "run-input" }, field: "input", before, after: runInput });
        break;
      }
    }
  }
  return { flow, agents, runInput, edits, skipped };
}

function rootInput(input: EvaluationInput): unknown {
  const root = input.flow.nodes.find((n) => n.dependsOn.length === 0);
  return root ? input.run.steps.find((s) => s.nodeId === root.id)?.input : undefined;
}

/** One line per edit, e.g. "Planner · Model: claude-opus-5-5 → claude-haiku-4-5". */
export function describeEdit(edit: PlannedEdit): string {
  const where = edit.target.kind === "run-input" ? "Run" : edit.target.name;
  return `${where} · ${FIELD_LABELS[edit.field]}`;
}
