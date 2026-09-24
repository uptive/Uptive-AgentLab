import type { Run, TraceEvent } from "@agentlab/contracts";

export interface TelemetryStore {
  recordEvent(event: TraceEvent): Promise<void>;
  listEvents(runId: string): Promise<TraceEvent[]>;
  saveRun(run: Run): Promise<void>;
  getRun(runId: string): Promise<Run | undefined>;
  listRuns(): Promise<Run[]>;
}

// In-memory store for tests and mocks. The desktop app uses the MongoDB store
// from "@agentlab/observability/mongo" in the Electron main process.
export function createMemoryTelemetryStore(): TelemetryStore {
  const runs = new Map<string, Run>();
  const events: TraceEvent[] = [];

  return {
    async recordEvent(event) {
      events.push(event);
    },
    async listEvents(runId) {
      return events.filter((event) => event.runId === runId);
    },
    async saveRun(run) {
      runs.set(run.id, run);
    },
    async getRun(runId) {
      return runs.get(runId);
    },
    async listRuns() {
      return Array.from(runs.values());
    },
  };
}

export const store: TelemetryStore = createMemoryTelemetryStore();
