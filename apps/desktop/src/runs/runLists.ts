import type { Run, RunStatus } from "@agentlab/contracts";

const newestFirst = (a: Run, b: Run) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();

const isActive = (run: Run) => run.status === "running" || run.status === "pending";

/** Runs executing right now, newest first. */
export function activeRuns(runs: readonly Run[]): Run[] {
  return runs.filter(isActive).sort(newestFirst);
}

export function countActiveRuns(runs: readonly Run[]): number {
  return runs.filter(isActive).length;
}

export interface RunFilter {
  status: RunStatus | "all";
  flowId: string | "all";
  /** Matched case-insensitively against the flow name and the run id. */
  query: string;
}

export const EMPTY_RUN_FILTER: RunFilter = { status: "all", flowId: "all", query: "" };

/** Runs matching `filter`, newest first. `flowName` resolves the name shown for a run. */
export function filterRuns(runs: readonly Run[], filter: RunFilter, flowName: (run: Run) => string): Run[] {
  const query = filter.query.trim().toLowerCase();
  return runs
    .filter((run) => filter.status === "all" || run.status === filter.status)
    .filter((run) => filter.flowId === "all" || run.flowId === filter.flowId)
    .filter((run) => !query || flowName(run).toLowerCase().includes(query) || run.id.toLowerCase().includes(query))
    .sort(newestFirst);
}
