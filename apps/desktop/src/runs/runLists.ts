import type { Run, RunStatus } from "@agentlab/contracts";

/** How long a finished run stays on the Live tab, so it doesn't vanish the moment it ends. */
export const RECENTLY_FINISHED_MS = 5 * 60 * 1000;

const newestFirst = (a: Run, b: Run) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();

const isActive = (run: Run) => run.status === "running" || run.status === "pending";

/** Splits runs into what is executing now and what finished within the last few minutes, newest first. */
export function partitionLiveRuns(runs: readonly Run[], now: number): { active: Run[]; recentlyFinished: Run[] } {
  const active: Run[] = [];
  const recentlyFinished: Run[] = [];
  for (const run of runs) {
    if (isActive(run)) {
      active.push(run);
    } else if (run.completedAt && now - new Date(run.completedAt).getTime() <= RECENTLY_FINISHED_MS) {
      recentlyFinished.push(run);
    }
  }
  return { active: active.sort(newestFirst), recentlyFinished: recentlyFinished.sort(newestFirst) };
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
