import { describe, expect, it } from "vitest";
import type { Run, TraceEvent } from "@agentlab/contracts";
import { createTelemetryStore, type PersistedState } from "../src/index.js";

const run = (id: string, status: Run["status"]): Run => ({ id, flowId: "f", status, startedAt: "2026-09-25T12:00:00Z", steps: [] });
const event = (id: string): TraceEvent => ({ id, runId: "r1", type: "model_call", timestamp: "2026-09-25T12:00:01Z", data: {} });

function storeWith(persisted: PersistedState) {
  let release: () => void = () => {};
  const loaded = new Promise<void>((resolve) => (release = resolve));
  const store = createTelemetryStore({
    adapter: { load: async () => (await loaded, persisted), save: async () => {} },
    writeDebounceMs: 60_000,
  });
  return { store, release };
}

describe("telemetry store", () => {
  it("ignores an event it has already recorded", () => {
    const store = createTelemetryStore();
    store.recordEvent(event("e1"));
    store.recordEvent(event("e1"));
    expect(store.listEvents("r1")).toHaveLength(1);
  });

  it("does not duplicate live events when hydrate loads the same ones", async () => {
    const { store, release } = storeWith({ version: 1, runs: [], events: [event("e1"), event("e2")] });
    const hydrating = store.hydrate();
    store.recordEvent(event("e1"));
    release();
    await hydrating;
    expect(store.listEvents("r1").map((e) => e.id)).toEqual(["e1", "e2"]);
  });

  it("keeps the live copy of a run over the persisted one", async () => {
    const { store, release } = storeWith({ version: 1, runs: [run("r1", "running")], events: [] });
    const hydrating = store.hydrate();
    store.saveRun(run("r1", "completed"));
    release();
    await hydrating;
    expect(store.getRun("r1")?.status).toBe("completed");
  });
});
