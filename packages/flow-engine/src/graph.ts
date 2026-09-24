import type { FlowDefinition, FlowNode } from "@agentlab/contracts";

export type FlowIssueCode =
  | "EMPTY_FLOW"
  | "DUPLICATE_NODE_ID"
  | "MISSING_DEPENDENCY"
  | "SELF_DEPENDENCY"
  | "DUPLICATE_DEPENDENCY"
  | "CYCLE"
  | "UNKNOWN_AGENT"
  | "INVALID_INPUT_MAPPING";

export interface FlowIssue {
  code: FlowIssueCode;
  message: string;
  nodeId?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: FlowIssue[];
}

export interface ValidateOptions {
  /** When provided, every node's agentId must be in this set. */
  knownAgentIds?: Iterable<string>;
}

export class FlowValidationError extends Error {
  constructor(public readonly errors: FlowIssue[]) {
    super(`Invalid flow:\n${errors.map((e) => `  - ${e.message}`).join("\n")}`);
    this.name = "FlowValidationError";
  }
}

/** Map of nodeId -> ids of nodes that depend on it (downstream edges). */
export function getDependents(flow: FlowDefinition): Map<string, string[]> {
  const dependents = new Map<string, string[]>(flow.nodes.map((n) => [n.id, []]));
  for (const node of flow.nodes) {
    for (const dep of new Set(node.dependsOn)) {
      dependents.get(dep)?.push(node.id);
    }
  }
  return dependents;
}

/**
 * Groups nodes into execution "levels": every node in level N only depends on
 * nodes in levels < N, so all nodes in a level may run in parallel.
 * Throws if the graph contains a cycle or references unknown nodes.
 */
export function topologicalLevels(flow: FlowDefinition): string[][] {
  const { levels, unresolved } = kahn(flow);
  if (unresolved.length > 0) {
    throw new FlowValidationError([
      { code: "CYCLE", message: `Cycle detected involving: ${unresolved.join(", ")}` },
    ]);
  }
  return levels;
}

/** Returns true if adding the edge `sourceId -> targetId` would create a cycle. */
export function wouldCreateCycle(flow: FlowDefinition, sourceId: string, targetId: string): boolean {
  if (sourceId === targetId) return true;
  // A cycle appears if `sourceId` is already reachable from `targetId`.
  const dependents = getDependents(flow);
  const stack = [targetId];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === sourceId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    stack.push(...(dependents.get(current) ?? []));
  }
  return false;
}

export function validateFlow(flow: FlowDefinition, options: ValidateOptions = {}): ValidationResult {
  const errors: FlowIssue[] = [];
  const ids = new Set<string>();

  if (flow.nodes.length === 0) {
    errors.push({ code: "EMPTY_FLOW", message: "Flow has no nodes" });
  }

  for (const node of flow.nodes) {
    if (ids.has(node.id)) {
      errors.push({ code: "DUPLICATE_NODE_ID", nodeId: node.id, message: `Duplicate node id "${node.id}"` });
    }
    ids.add(node.id);
  }

  const knownAgents = options.knownAgentIds ? new Set(options.knownAgentIds) : undefined;

  for (const node of flow.nodes) {
    const seenDeps = new Set<string>();
    for (const dep of node.dependsOn) {
      if (dep === node.id) {
        errors.push({ code: "SELF_DEPENDENCY", nodeId: node.id, message: `Node "${node.id}" depends on itself` });
      } else if (!ids.has(dep)) {
        errors.push({
          code: "MISSING_DEPENDENCY",
          nodeId: node.id,
          message: `Node "${node.id}" depends on unknown node "${dep}"`,
        });
      }
      if (seenDeps.has(dep)) {
        errors.push({
          code: "DUPLICATE_DEPENDENCY",
          nodeId: node.id,
          message: `Node "${node.id}" lists dependency "${dep}" more than once`,
        });
      }
      seenDeps.add(dep);
    }

    if (knownAgents && !knownAgents.has(node.agentId)) {
      errors.push({
        code: "UNKNOWN_AGENT",
        nodeId: node.id,
        message: `Node "${node.id}" references unknown agent "${node.agentId}"`,
      });
    }

    errors.push(...validateInputMapping(node));
  }

  // Only check for cycles when references are sound; otherwise results are noise.
  if (!errors.some((e) => e.code === "MISSING_DEPENDENCY" || e.code === "SELF_DEPENDENCY")) {
    const { unresolved } = kahn(flow);
    if (unresolved.length > 0) {
      errors.push({ code: "CYCLE", message: `Cycle detected involving: ${unresolved.join(", ")}` });
    }
  }

  return { valid: errors.length === 0, errors };
}

export function assertValidFlow(flow: FlowDefinition, options?: ValidateOptions): void {
  const result = validateFlow(flow, options);
  if (!result.valid) throw new FlowValidationError(result.errors);
}

function validateInputMapping(node: FlowNode): FlowIssue[] {
  if (!node.inputMapping) return [];
  const issues: FlowIssue[] = [];
  const deps = new Set(node.dependsOn);
  for (const [key, ref] of Object.entries(node.inputMapping)) {
    const root = ref.split(".")[0];
    if (root !== "$input" && !deps.has(root)) {
      issues.push({
        code: "INVALID_INPUT_MAPPING",
        nodeId: node.id,
        message: `Node "${node.id}" maps "${key}" from "${ref}", but "${root}" is not a dependency`,
      });
    }
  }
  return issues;
}

function kahn(flow: FlowDefinition): { levels: string[][]; unresolved: string[] } {
  const ids = new Set(flow.nodes.map((n) => n.id));
  const inDegree = new Map<string, number>();
  for (const node of flow.nodes) {
    const deps = new Set(node.dependsOn);
    for (const dep of deps) {
      if (!ids.has(dep)) throw new FlowValidationError([
        { code: "MISSING_DEPENDENCY", nodeId: node.id, message: `Node "${node.id}" depends on unknown node "${dep}"` },
      ]);
    }
    inDegree.set(node.id, deps.size);
  }

  const dependents = getDependents(flow);
  const levels: string[][] = [];
  let current = flow.nodes.filter((n) => inDegree.get(n.id) === 0).map((n) => n.id);
  let visited = 0;

  while (current.length > 0) {
    levels.push(current);
    visited += current.length;
    const next: string[] = [];
    for (const id of current) {
      for (const child of dependents.get(id) ?? []) {
        const remaining = inDegree.get(child)! - 1;
        inDegree.set(child, remaining);
        if (remaining === 0) next.push(child);
      }
    }
    current = next;
  }

  const unresolved = visited === flow.nodes.length ? [] : [...inDegree].filter(([, d]) => d > 0).map(([id]) => id);
  return { levels, unresolved };
}
