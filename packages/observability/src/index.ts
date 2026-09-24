import type { Run, TraceEvent } from "@agentlab/contracts";

export interface TelemetryStore {
  recordEvent(event: TraceEvent): void;
  saveRun(run: Run): void;
  getRun(runId: string): Run | undefined;
  listRuns(): Run[];
}

const runs = new Map<string, Run>();
const events: TraceEvent[] = [];

export const store: TelemetryStore = {
  recordEvent(event: TraceEvent): void {
    events.push(event);
  },
  saveRun(run: Run): void {
    runs.set(run.id, run);
  },
  getRun(runId: string): Run | undefined {
    return runs.get(runId);
  },
  listRuns(): Run[] {
    return Array.from(runs.values());
  },
};
