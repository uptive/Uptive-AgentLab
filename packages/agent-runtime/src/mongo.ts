import type { Db } from "mongodb";
import { DEFAULT_AGENT_ROLES, type AgentDefinition, type AgentRoleStore, type AgentStore } from "@agentlab/contracts";
import { normalizeAgent, validateAgentInput } from "./agentStore.js";

// Node-only: import this from the Electron main process, never the renderer.

type AgentDoc = AgentDefinition & { _id: string };

function stripId({ _id, ...rest }: AgentDoc): AgentDefinition {
  return normalizeAgent(rest);
}

export interface MongoAgentStore extends AgentStore {
  /** Stores an existing agent under its own id (e.g. one promoted from the local folder). Throws if the id is taken. */
  insert(agent: AgentDefinition): Promise<AgentDefinition>;
}

export async function createMongoAgentStore(db: Db): Promise<MongoAgentStore> {
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
      const agent = normalizeAgent({ ...input, id, createdAt: now, updatedAt: now } as AgentDefinition);
      await agents.insertOne({ _id: id, ...agent });
      return agent;
    },
    async insert(existing) {
      validateAgentInput(existing);
      if (await agents.findOne({ _id: existing.id }, { projection: { _id: 1 } })) {
        throw new Error(`An agent with id "${existing.id}" already exists in the database`);
      }
      const now = new Date().toISOString();
      const agent = normalizeAgent({ ...existing, createdAt: existing.createdAt ?? now, updatedAt: now });
      await agents.insertOne({ _id: agent.id, ...agent });
      return agent;
    },
    async update(id, patch) {
      const existing = await agents.findOne({ _id: id });
      if (!existing) throw new Error(`Agent ${id} not found`);
      const { id: _id, createdAt: _createdAt, ...fields } = patch as Partial<AgentDefinition>;
      const agent = normalizeAgent(
        Object.fromEntries(
          Object.entries({ ...stripId(existing), ...fields, id, updatedAt: new Date().toISOString() }).filter(([, value]) => value !== undefined),
        ) as unknown as AgentDefinition,
      );
      validateAgentInput(agent);
      await agents.replaceOne({ _id: id }, agent);
      return agent;
    },
    async delete(id) {
      const result = await agents.deleteOne({ _id: id });
      return result.deletedCount === 1;
    },
  };
}

/** Role docs are keyed by the lowercased name so "Reviewer" and "reviewer" are one role. */
type RoleDoc = { _id: string; name: string; createdAt: string };

export async function createMongoRoleStore(db: Db): Promise<AgentRoleStore> {
  const roles = db.collection<RoleDoc>("agent_roles");

  async function add(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    await roles.updateOne(
      { _id: trimmed.toLowerCase() },
      { $setOnInsert: { name: trimmed, createdAt: new Date().toISOString() } },
      { upsert: true },
    );
  }

  if ((await roles.estimatedDocumentCount()) === 0) await Promise.all(DEFAULT_AGENT_ROLES.map(add));

  return {
    async list() {
      const docs = await roles.find().sort({ _id: 1 }).toArray();
      return docs.map((doc) => doc.name);
    },
    add,
  };
}
