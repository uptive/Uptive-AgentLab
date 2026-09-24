import type { Db } from "mongodb";
import type { AgentDefinition, AgentStore } from "@agentlab/contracts";
import { validateAgentInput } from "./agentStore.js";

// Node-only: import this from the Electron main process, never the renderer.

type AgentDoc = AgentDefinition & { _id: string };

function stripId({ _id, ...rest }: AgentDoc): AgentDefinition {
  return rest;
}

export async function createMongoAgentStore(db: Db): Promise<AgentStore> {
  const agents = db.collection<AgentDoc>("agents");
  await agents.createIndex({ name: 1 });

  return {
    async list() {
      const docs = await agents.find().sort({ name: 1 }).toArray();
      return docs.map(stripId);
    },
    async get(id) {
      const doc = await agents.findOne({ _id: id });
      return doc ? stripId(doc) : undefined;
    },
    async create(input) {
      validateAgentInput(input);
      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      const agent: AgentDefinition = { ...input, tools: input.tools ?? [], id, createdAt: now, updatedAt: now };
      await agents.insertOne({ _id: id, ...agent });
      return agent;
    },
    async update(id, patch) {
      validateAgentInput(patch, true);
      const { id: _id, createdAt: _createdAt, ...fields } = patch as Partial<AgentDefinition>;
      // Fields explicitly set to undefined are cleared rather than stored as null.
      const $set: Record<string, unknown> = { updatedAt: new Date().toISOString() };
      const $unset: Record<string, ""> = {};
      for (const [key, value] of Object.entries(fields)) {
        if (value === undefined) $unset[key] = "";
        else $set[key] = value;
      }
      const doc = await agents.findOneAndUpdate(
        { _id: id },
        Object.keys($unset).length ? { $set, $unset } : { $set },
        { returnDocument: "after", ignoreUndefined: true },
      );
      if (!doc) throw new Error(`Agent ${id} not found`);
      return stripId(doc);
    },
    async delete(id) {
      const result = await agents.deleteOne({ _id: id });
      return result.deletedCount === 1;
    },
  };
}
