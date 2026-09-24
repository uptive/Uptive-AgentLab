import type { FlowDefinition } from "@agentlab/contracts";
import { topologicalLevels } from "./graph.js";

export interface NodeSchedule {
  /** When the node's dependencies were first partially satisfied (or 0 for roots). */
  firstInputAt: number;
  /** When the node starts, i.e. after *all* dependencies have handed off. */
  start: number;
  end: number;
}

export interface EdgeSchedule {
  source: string;
  target: string;
  /** Handoff travels along the edge between these times. */
  start: number;
  end: number;
}

export interface FlowSchedule {
  nodes: Record<string, NodeSchedule>;
  edges: EdgeSchedule[];
  totalDuration: number;
}

export interface ScheduleOptions {
  /** Simulated duration of a node, in ms. */
  durationOf?: (nodeId: string) => number;
  /** Time a handoff takes to travel along an edge, in ms. */
  handoffMs?: number;
}

/**
 * Computes a simulated timeline for a flow without executing any agents, using
 * the same semantics as the engine: a node starts once every dependency has
 * finished and handed off (join); independent nodes overlap (parallel).
 * Used by the editor's "demo run" animation.
 */
export function computeSchedule(flow: FlowDefinition, options: ScheduleOptions = {}): FlowSchedule {
  const durationOf = options.durationOf ?? (() => 1000);
  const handoffMs = options.handoffMs ?? 500;
  const byId = new Map(flow.nodes.map((n) => [n.id, n]));
  const nodes: Record<string, NodeSchedule> = {};
  const edges: EdgeSchedule[] = [];

  for (const level of topologicalLevels(flow)) {
    for (const id of level) {
      const deps = [...new Set(byId.get(id)!.dependsOn)];
      const arrivals = deps.map((d) => nodes[d].end + handoffMs);
      for (const d of deps) edges.push({ source: d, target: id, start: nodes[d].end, end: nodes[d].end + handoffMs });
      const start = arrivals.length ? Math.max(...arrivals) : 0;
      nodes[id] = { firstInputAt: arrivals.length ? Math.min(...arrivals) : 0, start, end: start + durationOf(id) };
    }
  }

  const totalDuration = Math.max(0, ...Object.values(nodes).map((n) => n.end));
  return { nodes, edges, totalDuration };
}

/** Deterministic pseudo-random duration in [min, max] derived from a string. */
export function hashedDuration(key: string, min = 900, max = 1900): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return min + ((h >>> 0) % (max - min + 1));
}
