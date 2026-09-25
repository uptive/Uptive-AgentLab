import type { Run, StepRun, TraceEvent } from "@agentlab/contracts";

export const PERSISTED_STATE_VERSION = 1 as const;

export interface PersistedState {
  version: typeof PERSISTED_STATE_VERSION;
  runs: Run[];
  events: TraceEvent[];
}

export interface RunPersistenceAdapter {
  load(): Promise<PersistedState | null>;
  save(state: PersistedState): Promise<void>;
}

/** A run as listed, without its steps, inputs or outputs. */
export interface RunListing {
  id: string;
  flowId: string;
  flowName?: string;
  status: Run["status"];
  startedAt: string;
  completedAt?: string;
}

export type StoreListener = () => void;

// Sync telemetry store used by the desktop renderer. React's useSyncExternalStore
// requires sync getSnapshot calls, so mutations and reads are synchronous and
// persistence is handled through a RunPersistenceAdapter behind the scenes.
export interface TelemetryStore {
  recordEvent(event: TraceEvent): void;
  saveRun(run: Run): void;
  getRun(runId: string): Run | undefined;
  listRuns(): Run[];
  listEvents(runId: string): TraceEvent[];
  subscribe(listener: StoreListener): () => void;
  hydrate(): Promise<void>;
}

// Async telemetry store used by node-side backends (MongoDB, etc). The Electron
// main process holds one of these and exposes it to the renderer via IPC as a
// RunPersistenceAdapter for the sync TelemetryStore above.
export interface AsyncTelemetryStore {
  recordEvent(event: TraceEvent): Promise<void>;
  listEvents(runId: string): Promise<TraceEvent[]>;
  saveRun(run: Run): Promise<void>;
  getRun(runId: string): Promise<Run | undefined>;
  listRuns(): Promise<Run[]>;
}

// In-memory AsyncTelemetryStore for tests and mocks. The desktop app uses the
// MongoDB store from "@agentlab/observability/mongo" in the Electron main
// process instead.
export function createMemoryTelemetryStore(): AsyncTelemetryStore {
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

export interface CreateTelemetryStoreOptions {
  adapter?: RunPersistenceAdapter;
  /** Coalescing window for disk writes. Defaults to 100ms. */
  writeDebounceMs?: number;
}

export function createTelemetryStore(options: CreateTelemetryStoreOptions = {}): TelemetryStore {
  const { adapter, writeDebounceMs = 100 } = options;
  const runs = new Map<string, Run>();
  const events: TraceEvent[] = [];
  const eventsByRunId = new Map<string, TraceEvent[]>();
  // Live events can arrive before hydrate() loads the same ones from disk; index each id once.
  const eventIds = new Set<string>();
  const listeners = new Set<StoreListener>();

  // React's useSyncExternalStore requires getSnapshot to return a stable
  // reference between mutations, so we cache the array snapshots and only
  // rebuild them when a mutation invalidates the relevant cache entry.
  let runsSnapshot: Run[] | undefined;
  const eventsSnapshotByRunId = new Map<string, TraceEvent[]>();

  let hydratePromise: Promise<void> | undefined;
  let dirty = false;
  let writeTimer: ReturnType<typeof setTimeout> | undefined;
  let inFlightWrite: Promise<void> | undefined;

  function notify(): void {
    for (const listener of listeners) {
      try {
        listener();
      } catch (err) {
        console.error("Telemetry listener threw:", err);
      }
    }
  }

  function snapshot(): PersistedState {
    return {
      version: PERSISTED_STATE_VERSION,
      runs: Array.from(runs.values()),
      events: [...events],
    };
  }

  async function flush(): Promise<void> {
    if (!adapter || !dirty) return;
    dirty = false;
    const state = snapshot();
    try {
      inFlightWrite = adapter.save(state);
      await inFlightWrite;
    } catch (err) {
      dirty = true;
      console.error("Failed to persist telemetry state:", err);
    } finally {
      inFlightWrite = undefined;
    }
  }

  function schedulePersist(): void {
    if (!adapter) return;
    dirty = true;
    if (writeTimer) return;
    writeTimer = setTimeout(() => {
      writeTimer = undefined;
      void flush();
    }, writeDebounceMs);
  }

  /** Returns false when the event was already indexed. */
  function indexEvent(event: TraceEvent): boolean {
    if (eventIds.has(event.id)) return false;
    eventIds.add(event.id);
    events.push(event);
    const bucket = eventsByRunId.get(event.runId);
    if (bucket) {
      bucket.push(event);
    } else {
      eventsByRunId.set(event.runId, [event]);
    }
    eventsSnapshotByRunId.delete(event.runId);
    return true;
  }

  return {
    recordEvent(event: TraceEvent): void {
      if (!indexEvent(event)) return;
      schedulePersist();
      notify();
    },
    saveRun(run: Run): void {
      runs.set(run.id, run);
      runsSnapshot = undefined;
      schedulePersist();
      notify();
    },
    getRun(runId: string): Run | undefined {
      return runs.get(runId);
    },
    listRuns(): Run[] {
      if (!runsSnapshot) runsSnapshot = Array.from(runs.values());
      return runsSnapshot;
    },
    listEvents(runId: string): TraceEvent[] {
      let cached = eventsSnapshotByRunId.get(runId);
      if (!cached) {
        cached = eventsByRunId.get(runId)?.slice() ?? [];
        eventsSnapshotByRunId.set(runId, cached);
      }
      return cached;
    },
    subscribe(listener: StoreListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    hydrate(): Promise<void> {
      if (hydratePromise) return hydratePromise;
      if (!adapter) {
        hydratePromise = Promise.resolve();
        return hydratePromise;
      }
      hydratePromise = (async () => {
        const loaded = await adapter.load();
        if (!loaded) return;
        if (loaded.version !== PERSISTED_STATE_VERSION) {
          console.warn(
            `Ignoring persisted telemetry with unsupported version ${String(loaded.version)}`,
          );
          return;
        }
        // A run already in memory came live from this session and is newer than the persisted copy.
        for (const run of loaded.runs) if (!runs.has(run.id)) runs.set(run.id, run);
        for (const event of loaded.events) indexEvent(event);
        runsSnapshot = undefined;
        notify();
      })();
      return hydratePromise;
    },
  };
}

let sharedStore: TelemetryStore | undefined;

/** Returns the process-wide store, creating an in-memory one on first use. */
export function getTelemetryStore(): TelemetryStore {
  if (!sharedStore) sharedStore = createTelemetryStore();
  return sharedStore;
}

/**
 * Replaces the process-wide store with one backed by the given adapter. Call once
 * at app bootstrap (before any group's runtime records events).
 */
export function initTelemetryStore(options: CreateTelemetryStoreOptions = {}): TelemetryStore {
  sharedStore = createTelemetryStore(options);
  return sharedStore;
}

export interface RunSummary {
  status: Run["status"];
  durationMs?: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  agentIds: string[];
  modelCallCount: number;
  toolCallCount: number;
}

/**
 * Aggregates tokens, cost and call counts across a run. Model/tool call counts
 * are derived from trace events when available and fall back to per-step data.
 */
export function summarizeRun(run: Run, events?: TraceEvent[]): RunSummary {
  const durationMs =
    run.completedAt !== undefined
      ? new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()
      : undefined;

  const summary: RunSummary = {
    status: run.status,
    durationMs,
    inputTokens: run.totalUsage?.inputTokens ?? 0,
    outputTokens: run.totalUsage?.outputTokens ?? 0,
    estimatedCostUsd: run.totalUsage?.estimatedCostUsd ?? 0,
    agentIds: [],
    modelCallCount: 0,
    toolCallCount: 0,
  };

  const seenAgents = new Set<string>();
  for (const step of run.steps) {
    seenAgents.add(step.agentId);
    if (!run.totalUsage && step.usage) {
      summary.inputTokens += step.usage.inputTokens;
      summary.outputTokens += step.usage.outputTokens;
      summary.estimatedCostUsd += step.usage.estimatedCostUsd;
    }
  }
  summary.agentIds = Array.from(seenAgents);

  const runEvents = events?.filter((event) => event.runId === run.id);
  if (runEvents && runEvents.length > 0) {
    for (const event of runEvents) {
      if (event.type === "model_call") summary.modelCallCount += 1;
      else if (event.type === "tool_call") summary.toolCallCount += 1;
    }
  } else {
    for (const step of run.steps) {
      summary.toolCallCount += step.toolCalls.length;
      summary.modelCallCount += step.usage ? 1 : 0;
    }
  }

  return summary;
}

export function getStepRun(run: Run, stepRunId: string): StepRun | undefined {
  return run.steps.find((step) => step.id === stepRunId);
}

/**
 * Closes out a run that can no longer progress (stopped by the user, crashed, or interrupted by a
 * quit): the run and every step still pending or running become failed with `reason`. Steps that
 * already finished keep their status, output, `completedAt` and `error`.
 */
export function interruptRun(run: Run, reason: string, at = new Date().toISOString()): Run {
  return {
    ...run,
    status: "failed",
    completedAt: run.completedAt ?? at,
    steps: run.steps.map((step) =>
      step.status === "running" || step.status === "pending"
        ? { ...step, status: "failed", completedAt: step.completedAt ?? at, error: step.error ?? reason }
        : step,
    ),
  };
}
