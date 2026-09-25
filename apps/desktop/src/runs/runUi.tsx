import { useEffect, useState, useSyncExternalStore, type CSSProperties } from "react";
import type { FlowDefinition, Run, RunStatus, TraceEvent } from "@agentlab/contracts";
import { getTelemetryStore } from "@agentlab/observability";
import { findFlow } from "@agentlab/flow-engine";
import { theme } from "../theme.js";
import type { Catalog } from "./catalog.js";
import { countActiveRuns } from "./runLists.js";

const STATUS_COLORS: Record<RunStatus, string> = {
  pending: theme.statusDraft,
  running: theme.warning,
  completed: theme.statusActive,
  failed: theme.danger,
};

export function StatusBadge({ status }: { status: RunStatus }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        color: theme.onStatus,
        background: STATUS_COLORS[status],
        textTransform: "capitalize",
      }}
    >
      {status}
    </span>
  );
}

export const buttonStyle = (variant: "primary" | "secondary" | "danger"): CSSProperties => ({
  padding: "8px 14px",
  borderRadius: 6,
  border: `1px solid ${variant === "primary" ? theme.primary : variant === "danger" ? theme.danger : theme.border}`,
  background: variant === "primary" ? theme.primary : theme.codeBg,
  color: variant === "primary" ? theme.onPrimary : variant === "danger" ? theme.danger : theme.primary,
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
  whiteSpace: "nowrap",
});

export const fieldStyle: CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  background: theme.codeBg,
  color: theme.text,
  border: `1px solid ${theme.border}`,
  borderRadius: 6,
  fontSize: 14,
  boxSizing: "border-box",
};

/** Re-renders every `intervalMs` while `active`, so live durations keep counting. */
export function useNow(active: boolean, intervalMs = 200): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs]);
  return active ? now : Date.now();
}

/** Every run in the telemetry store; re-renders when any run changes. */
export function useRuns(): Run[] {
  const store = getTelemetryStore();
  return useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.listRuns(),
    () => store.listRuns(),
  );
}

/** How many runs are executing; only re-renders when the count changes. */
export function useActiveRunCount(): number {
  const store = getTelemetryStore();
  const count = () => countActiveRuns(store.listRuns());
  return useSyncExternalStore((listener) => store.subscribe(listener), count, count);
}

/** The flow a run executed: its own snapshot, a known flow, or a flat graph rebuilt from its steps. */
export function resolveRunFlow(run: Run, catalog: Catalog): FlowDefinition {
  return (
    run.flow ??
    findFlow(run.flowId, catalog.flows.map((option) => option.flow)) ?? {
      id: run.flowId,
      name: run.flowId,
      nodes: run.steps.map((step) => ({ id: step.nodeId, agentId: step.agentId, dependsOn: [] })),
    }
  );
}

/** The input a run was started with, for reruns. Older runs only have it in their trace. */
export function resolveRunInput(run: Run, events: TraceEvent[]): unknown {
  if (run.input !== undefined) return run.input;
  const flowStart = events.find((event) => event.type === "flow_start")?.data as { input?: unknown } | undefined;
  return flowStart?.input ?? run.steps[0]?.input;
}
