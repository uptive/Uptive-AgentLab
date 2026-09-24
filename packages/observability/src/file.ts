// Node-only: file-backed telemetry for the Electron main process. Runs stay on this computer: they
// contain agent inputs and outputs (code, diffs, documents), so they are not shared by default.
import fs from "node:fs/promises";
import path from "node:path";
import type { Run, TraceEvent } from "@agentlab/contracts";
import { PERSISTED_STATE_VERSION, type AsyncTelemetryStore, type PersistedState } from "./index.js";

interface RunFile {
  run: Run;
  events: TraceEvent[];
}

export interface FileTelemetryStore extends AsyncTelemetryStore {
  readonly dir: string;
  /** Everything, for the renderer's sync store to hydrate from. */
  load(): Promise<PersistedState>;
  /** Replaces the stored runs with a full snapshot; only runs that changed are rewritten. */
  saveState(state: PersistedState): Promise<void>;
}

const safeName = (runId: string) => runId.replace(/[^\w.-]/g, "_");

/** One JSON file per run (`<dir>/<runId>.json`) holding the run and its trace events. */
export function createFileTelemetryStore(dir: string): FileTelemetryStore {
  let cache: Map<string, RunFile> | undefined;
  const written = new Map<string, string>(); // runId -> serialized content on disk
  let queue: Promise<unknown> = Promise.resolve();
  // Events that arrive just before their run's first snapshot (e.g. flow_start) wait here.
  const orphans = new Map<string, TraceEvent[]>();

  async function loadAll(): Promise<Map<string, RunFile>> {
    if (cache) return cache;
    const loaded = new Map<string, RunFile>();
    await fs.mkdir(dir, { recursive: true });
    for (const name of (await fs.readdir(dir)).filter((n) => n.endsWith(".json"))) {
      try {
        const text = await fs.readFile(path.join(dir, name), "utf8");
        const file = JSON.parse(text) as RunFile;
        if (!file?.run?.id) throw new Error("missing run id");
        loaded.set(file.run.id, { run: file.run, events: Array.isArray(file.events) ? file.events : [] });
        written.set(file.run.id, text);
      } catch (error) {
        console.warn(`[telemetry] skipping ${name}: ${(error as Error).message}`);
      }
    }
    cache = loaded;
    return loaded;
  }

  /** Serializes writes and skips files whose content did not change. */
  function persist(runIds: Iterable<string>): Promise<void> {
    const ids = [...new Set(runIds)];
    const next = queue.then(async () => {
      const all = await loadAll();
      for (const id of ids) {
        const file = all.get(id);
        if (!file) continue;
        const text = JSON.stringify(file);
        if (written.get(id) === text) continue;
        const target = path.join(dir, `${safeName(id)}.json`);
        await fs.writeFile(`${target}.tmp`, text, "utf8");
        await fs.rename(`${target}.tmp`, target);
        written.set(id, text);
      }
    });
    queue = next.catch(() => undefined);
    return next;
  }

  const fileFor = async (runId: string): Promise<RunFile | undefined> => (await loadAll()).get(runId);

  return {
    dir,
    async recordEvent(event) {
      const file = await fileFor(event.runId);
      if (!file) {
        orphans.set(event.runId, [...(orphans.get(event.runId) ?? []), event]);
        return;
      }
      if (!file.events.some((e) => e.id === event.id)) file.events.push(event);
      await persist([event.runId]);
    },
    async listEvents(runId) {
      return [...((await fileFor(runId))?.events ?? [])];
    },
    async saveRun(run) {
      const all = await loadAll();
      const existing = all.get(run.id);
      const waiting = orphans.get(run.id) ?? [];
      orphans.delete(run.id);
      all.set(run.id, { run, events: [...waiting, ...(existing?.events ?? [])] });
      await persist([run.id]);
    },
    async getRun(runId) {
      return (await fileFor(runId))?.run;
    },
    async listRuns() {
      return [...(await loadAll()).values()].map((f) => f.run);
    },
    async load() {
      const all = await loadAll();
      const files = [...all.values()];
      return { version: PERSISTED_STATE_VERSION, runs: files.map((f) => f.run), events: files.flatMap((f) => f.events) };
    },
    async saveState(state) {
      const all = await loadAll();
      const eventsByRun = new Map<string, TraceEvent[]>();
      for (const event of state.events) {
        const bucket = eventsByRun.get(event.runId);
        if (bucket) bucket.push(event);
        else eventsByRun.set(event.runId, [event]);
      }
      for (const run of state.runs) all.set(run.id, { run, events: eventsByRun.get(run.id) ?? [] });
      await persist(state.runs.map((r) => r.id));
    },
  };
}
