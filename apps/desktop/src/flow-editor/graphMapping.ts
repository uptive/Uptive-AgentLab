import type { Edge, Node } from "@xyflow/react";
import type { FlowDefinition } from "@agentlab/contracts";
import { topologicalLevels } from "@agentlab/flow-engine";

export type AgentNodeData = {
  agentId: string;
  label?: string;
  /** Preserved so round-tripping a JSON file doesn't drop it. */
  inputMapping?: Record<string, string>;
};
export type AgentFlowNode = Node<AgentNodeData, "agent">;

export interface FlowMeta {
  id: string;
  name: string;
  description?: string;
}

export const COLUMN_WIDTH = 300;
export const ROW_HEIGHT = 130;

export const edgeId = (source: string, target: string) => `${source}->${target}`;

export function makeEdge(source: string, target: string): Edge {
  return { id: edgeId(source, target), source, target };
}

/** Editor graph -> FlowDefinition. An edge A->B means "B dependsOn A". */
export function graphToFlow(meta: FlowMeta, nodes: AgentFlowNode[], edges: Edge[]): FlowDefinition {
  return {
    id: meta.id,
    name: meta.name,
    ...(meta.description ? { description: meta.description } : {}),
    nodes: nodes.map((n) => ({
      id: n.id,
      agentId: n.data.agentId,
      ...(n.data.label ? { label: n.data.label } : {}),
      dependsOn: edges.filter((e) => e.target === n.id).map((e) => e.source),
      ...(n.data.inputMapping ? { inputMapping: n.data.inputMapping } : {}),
      position: { x: n.position.x, y: n.position.y },
    })),
  };
}

/** FlowDefinition -> editor graph. Nodes without a stored position are auto-laid out. */
export function flowToGraph(flow: FlowDefinition): { meta: FlowMeta; nodes: AgentFlowNode[]; edges: Edge[] } {
  const fallback = layoutPositions(flow);
  const nodeIds = new Set(flow.nodes.map((n) => n.id));
  return {
    meta: { id: flow.id, name: flow.name, description: flow.description },
    nodes: flow.nodes.map((n) => ({
      id: n.id,
      type: "agent",
      position: n.position ?? fallback.get(n.id) ?? { x: 0, y: 0 },
      data: { agentId: n.agentId, label: n.label, inputMapping: n.inputMapping },
    })),
    // Drop edges to unknown nodes; validation will still report them from the raw file.
    edges: flow.nodes.flatMap((n) => n.dependsOn.filter((d) => nodeIds.has(d)).map((d) => makeEdge(d, n.id))),
  };
}

/** Column per execution level, nodes in a level stacked and vertically centred. */
export function layoutPositions(flow: FlowDefinition): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  let levels: string[][];
  try {
    levels = topologicalLevels(flow);
  } catch {
    levels = [flow.nodes.map((n) => n.id)]; // cyclic/broken graph: single column
  }
  const tallest = Math.max(1, ...levels.map((l) => l.length));
  levels.forEach((level, col) => {
    const offset = ((tallest - level.length) * ROW_HEIGHT) / 2;
    level.forEach((id, row) => positions.set(id, { x: col * COLUMN_WIDTH, y: offset + row * ROW_HEIGHT }));
  });
  return positions;
}

export function uniqueNodeId(base: string, existing: Iterable<string>): string {
  const taken = new Set(existing);
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

export const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "flow";
