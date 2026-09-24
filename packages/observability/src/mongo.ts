import type { Db } from "mongodb";
import type { Run, TraceEvent } from "@agentlab/contracts";
import type { TelemetryStore } from "./index.js";

// Node-only: import this from the Electron main process, never the renderer.

type RunDoc = Run & { _id: string };
type TraceEventDoc = TraceEvent & { _id: string };

function stripId<T extends { _id: string }>({ _id, ...rest }: T): Omit<T, "_id"> {
  return rest;
}

export async function createMongoTelemetryStore(db: Db): Promise<TelemetryStore> {
  const runs = db.collection<RunDoc>("runs");
  const events = db.collection<TraceEventDoc>("traceEvents");

  await Promise.all([
    runs.createIndex({ startedAt: -1 }),
    events.createIndex({ runId: 1, timestamp: 1 }),
  ]);

  return {
    async recordEvent(event) {
      await events.insertOne({ _id: event.id, ...event });
    },
    async listEvents(runId) {
      const docs = await events.find({ runId }).sort({ timestamp: 1 }).toArray();
      return docs.map(stripId);
    },
    async saveRun(run) {
      await runs.replaceOne({ _id: run.id }, run, { upsert: true });
    },
    async getRun(runId) {
      const doc = await runs.findOne({ _id: runId });
      return doc ? stripId(doc) : undefined;
    },
    async listRuns() {
      const docs = await runs.find().sort({ startedAt: -1 }).toArray();
      return docs.map(stripId);
    },
  };
}
