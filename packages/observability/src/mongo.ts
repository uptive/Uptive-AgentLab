import type { Db } from "mongodb";
import type { Run, TraceEvent } from "@agentlab/contracts";
import type { AsyncTelemetryStore, RunListing } from "./index.js";

// Node-only: import this from the Electron main process, never the renderer.

type RunDoc = Run & { _id: string };
type TraceEventDoc = TraceEvent & { _id: string };

function stripId<T extends { _id: string }>({ _id, ...rest }: T): Omit<T, "_id"> {
  return rest;
}

export async function createMongoTelemetryStore(db: Db): Promise<AsyncTelemetryStore> {
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

/**
 * Read-only access to runs other people saved to the shared database before runs moved to local
 * files. Never writes and never creates indexes.
 */
export interface MongoRunReader {
  listRuns(): Promise<RunListing[]>;
  /** The run and its trace events, or undefined when it doesn't exist. */
  getRun(runId: string): Promise<{ run: Run; events: TraceEvent[] } | undefined>;
}

export function createMongoRunReader(db: Db): MongoRunReader {
  const runs = db.collection<RunDoc>("runs");
  const events = db.collection<TraceEventDoc>("traceEvents");
  return {
    async listRuns() {
      const docs = await runs
        .find({}, { projection: { id: 1, flowId: 1, "flow.name": 1, status: 1, startedAt: 1, completedAt: 1 } })
        .sort({ startedAt: -1 })
        .toArray();
      return docs.map((doc) => ({
        id: doc.id,
        flowId: doc.flowId,
        flowName: doc.flow?.name,
        status: doc.status,
        startedAt: doc.startedAt,
        completedAt: doc.completedAt,
      }));
    },
    async getRun(runId) {
      const doc = await runs.findOne({ _id: runId });
      if (!doc) return undefined;
      const eventDocs = await events.find({ runId }).sort({ timestamp: 1 }).toArray();
      return { run: stripId(doc), events: eventDocs.map(stripId) };
    },
  };
}
