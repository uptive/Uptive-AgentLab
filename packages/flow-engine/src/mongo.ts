import type { Db } from "mongodb";
import type { FlowDefinition, FlowRecord, FlowStore } from "@agentlab/contracts";
import { parseFlowShape } from "./serialization.js";

// Node-only: import this from the Electron main process, never the renderer.

type FlowDoc = FlowRecord & { _id: string };

function stripId({ _id, ...rest }: FlowDoc): FlowRecord {
  return rest;
}

export async function createMongoFlowStore(db: Db): Promise<FlowStore> {
  const flows = db.collection<FlowDoc>("flows");
  await flows.createIndex({ name: 1 });

  return {
    async list() {
      const docs = await flows.find().sort({ name: 1 }).toArray();
      return docs.map(stripId);
    },
    async get(id) {
      const doc = await flows.findOne({ _id: id });
      return doc ? stripId(doc) : undefined;
    },
    async save(input: FlowDefinition) {
      const flow = parseFlowShape(input);
      const existing = await flows.findOne({ _id: flow.id });
      const now = new Date().toISOString();
      const record: FlowRecord = { ...flow, createdAt: existing?.createdAt ?? now, updatedAt: now };
      await flows.replaceOne({ _id: flow.id }, record, { upsert: true });
      return record;
    },
    async delete(id) {
      const result = await flows.deleteOne({ _id: id });
      return result.deletedCount === 1;
    },
  };
}
