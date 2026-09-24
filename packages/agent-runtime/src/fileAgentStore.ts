import fs from "node:fs/promises";
import path from "node:path";
import type { AgentDefinition, AgentStore } from "@agentlab/contracts";
import { validateAgentInput } from "./agentStore.js";

// Node-only: import this from the Electron main process, never the renderer.

/** Agents kept as pretty-printed JSON files, one per agent, in a folder. */
export interface FileAgentStore extends AgentStore {
  readonly dir: string;
  /** Reads every *.json file in the folder, replacing what was loaded before. Returns the number of agents. */
  load(): Promise<number>;
}

/**
 * Serves agents from memory: call `load()` once at startup to read the folder.
 * Writes go straight to the files. A file without an `id` uses its file name instead,
 * so hand-written agents only need the required fields.
 */
export function createFileAgentStore(dir: string): FileAgentStore {
  const agents = new Map<string, { agent: AgentDefinition; file: string }>();

  const fileFor = (id: string) => path.join(dir, `${id.replace(/[^\w.-]/g, "_")}.json`);

  async function write(file: string, agent: AgentDefinition) {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(file, `${JSON.stringify(agent, null, 2)}\n`);
  }

  function find(id: string) {
    const entry = agents.get(id);
    if (!entry) throw new Error(`Agent ${id} not found`);
    return entry;
  }

  return {
    dir,
    async load() {
      await fs.mkdir(dir, { recursive: true });
      agents.clear();
      for (const name of (await fs.readdir(dir)).filter((n) => n.endsWith(".json")).sort()) {
        const file = path.join(dir, name);
        try {
          const parsed = JSON.parse(await fs.readFile(file, "utf8")) as Partial<AgentDefinition>;
          const agent = { ...parsed, id: parsed.id || path.basename(name, ".json"), tools: parsed.tools ?? [] } as AgentDefinition;
          validateAgentInput(agent);
          if (agents.has(agent.id)) throw new Error(`id "${agent.id}" is already used by ${agents.get(agent.id)!.file}`);
          agents.set(agent.id, { agent, file });
        } catch (error) {
          console.warn(`[agents] skipping ${file}: ${(error as Error).message}`);
        }
      }
      return agents.size;
    },
    async list() {
      return Array.from(agents.values(), (entry) => entry.agent).sort((a, b) => a.name.localeCompare(b.name));
    },
    async get(id) {
      return agents.get(id)?.agent;
    },
    async create(input) {
      validateAgentInput(input);
      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      const agent: AgentDefinition = { ...input, tools: input.tools ?? [], id, createdAt: now, updatedAt: now };
      const file = fileFor(id);
      await write(file, agent);
      agents.set(id, { agent, file });
      return agent;
    },
    async update(id, patch) {
      validateAgentInput(patch, true);
      const entry = find(id);
      const { id: _id, createdAt: _createdAt, ...fields } = patch as Partial<AgentDefinition>;
      const merged: Record<string, unknown> = { ...entry.agent, ...fields, updatedAt: new Date().toISOString() };
      // Fields explicitly set to undefined are cleared.
      const agent = Object.fromEntries(Object.entries(merged).filter(([, value]) => value !== undefined)) as unknown as AgentDefinition;
      await write(entry.file, agent);
      entry.agent = agent;
      return agent;
    },
    async delete(id) {
      const entry = agents.get(id);
      if (!entry) return false;
      await fs.rm(entry.file, { force: true });
      agents.delete(id);
      return true;
    },
  };
}
