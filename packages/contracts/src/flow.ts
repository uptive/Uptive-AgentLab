import type { AgentDefinition } from "./agent.js";

export interface FlowNodePosition {
  x: number;
  y: number;
}

/**
 * A single step in a flow. Each node runs exactly one agent.
 *
 * Edges are expressed via `dependsOn`: a node starts once *all* nodes listed
 * there have completed (join). Nodes whose dependencies are satisfied at the
 * same time run in parallel; a chain of single dependencies runs sequentially.
 */
export interface FlowNode {
  id: string;
  agentId: string;
  /** Ids of upstream nodes that must complete before this node starts. */
  dependsOn: string[];
  /**
   * Optional explicit input shape. Keys are fields of the input object passed
   * to the agent; values are references:
   *   - "$input" / "$input.some.path"   -> the flow input
   *   - "<nodeId>" / "<nodeId>.path"    -> output of an upstream node (must be in `dependsOn`)
   * When omitted, the engine derives the input from the dependencies.
   */
  inputMapping?: Record<string, string>;
  /** Optional display label; falls back to the agent name in the UI. */
  label?: string;
  /** Canvas position used by the flow editor. Ignored by the engine. */
  position?: FlowNodePosition;
}

export interface FlowDefinition {
  id: string;
  name: string;
  description?: string;
  /**
   * Free-form labels for finding the flow later. Trimmed, non-empty and unique
   * (case-insensitive); see `normalizeTags` in `@agentlab/flow-engine`.
   */
  tags?: string[];
  nodes: FlowNode[];
}

/** Wraps a single agent in a one-node flow so it can go through the same engine and views. */
export function singleAgentFlow(agent: Pick<AgentDefinition, "id" | "name">): FlowDefinition {
  return {
    id: `agent:${agent.id}`,
    name: agent.name,
    description: `Single-agent run of ${agent.name}`,
    nodes: [{ id: agent.id, agentId: agent.id, dependsOn: [] }],
  };
}

export interface FlowRecord extends FlowDefinition {
  createdAt: string;
  updatedAt: string;
}

/** Persistence for flows saved to MongoDB. Flows keep their own client-chosen id (unlike agents), so writes are an upsert. */
export interface FlowStore {
  list(): Promise<FlowRecord[]>;
  get(id: string): Promise<FlowRecord | undefined>;
  save(flow: FlowDefinition): Promise<FlowRecord>;
  delete(id: string): Promise<boolean>;
}
