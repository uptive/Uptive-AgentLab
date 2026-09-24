import { useCallback, useEffect, useRef, useState } from "react";
import type { FlowDefinition } from "@agentlab/contracts";
import { computeSchedule, hashedDuration, type FlowSchedule } from "@agentlab/flow-engine";
import { edgeId } from "./graphMapping.js";

/** "failed" is only produced by real runs (see RunGraph), never by the simulated demo. */
export type DemoNodeState = "idle" | "waiting" | "running" | "done" | "failed";

export interface DemoNodeFrame {
  state: DemoNodeState;
  /** 0..1 progress while running. */
  progress: number;
  /** Dependencies that have handed off so far / total dependencies. */
  arrived: number;
  total: number;
  /** Optional one-line caption, e.g. latency and tokens of a finished step. */
  detail?: string;
}

export interface DemoFrame {
  playing: boolean;
  nodes: Record<string, DemoNodeFrame>;
  /** Per edge id: undefined = not reached, 0..1 = handoff in flight, 1 = delivered. */
  edges: Record<string, number | undefined>;
}

const HANDOFF_MS = 700;

/**
 * Animates a flow along its simulated schedule (no agents are executed).
 * Nodes run once all dependencies have handed off; parallel branches overlap.
 */
export function useDemoRun() {
  const [frame, setFrame] = useState<DemoFrame>();
  const raf = useRef<number>();

  const cancel = () => {
    if (raf.current !== undefined) cancelAnimationFrame(raf.current);
    raf.current = undefined;
  };

  const start = useCallback((flow: FlowDefinition) => {
    cancel();
    const schedule = computeSchedule(flow, {
      durationOf: (id) => hashedDuration(id),
      handoffMs: HANDOFF_MS,
    });
    const t0 = performance.now();
    const tick = () => {
      const elapsed = performance.now() - t0;
      const playing = elapsed < schedule.totalDuration;
      setFrame(frameAt(flow, schedule, playing ? elapsed : schedule.totalDuration, playing));
      raf.current = playing ? requestAnimationFrame(tick) : undefined;
    };
    tick();
  }, []);

  const stop = useCallback(() => {
    cancel();
    setFrame(undefined);
  }, []);

  useEffect(() => cancel, []);

  return { frame, start, stop };
}

function frameAt(flow: FlowDefinition, schedule: FlowSchedule, t: number, playing: boolean): DemoFrame {
  const nodes: Record<string, DemoNodeFrame> = {};
  const edges: Record<string, number | undefined> = {};

  for (const e of schedule.edges) {
    edges[edgeId(e.source, e.target)] = t < e.start ? undefined : Math.min(1, (t - e.start) / (e.end - e.start));
  }

  for (const node of flow.nodes) {
    const s = schedule.nodes[node.id];
    const arrived = node.dependsOn.filter((d) => edges[edgeId(d, node.id)] === 1).length;
    let state: DemoNodeState;
    if (t >= s.end) state = "done";
    else if (t >= s.start) state = "running";
    else if (arrived > 0) state = "waiting";
    else state = "idle";
    const progress = state === "done" ? 1 : state === "running" ? (t - s.start) / (s.end - s.start) : 0;
    nodes[node.id] = { state, progress, arrived, total: node.dependsOn.length };
  }

  return { playing, nodes, edges };
}
