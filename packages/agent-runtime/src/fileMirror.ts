import fs from "node:fs/promises";
import path from "node:path";
import type { AgentDefinition, AgentStore } from "@agentlab/contracts";
import { validateAgentInput } from "./agentStore.js";

// Node-only: import this from the Electron main process, never the renderer.

/** Reads and writes agent definitions as pretty-printed JSON files, one per agent, in a folder. */
export interface AgentFileMirror {
  readonly dir: string;
  readAll(): Promise<AgentDefinition[]>;
  save(agent: AgentDefinition): Promise<void>;
  remove(id: string): Promise<void>;
}

export function createAgentFileMirror(dir: string): AgentFileMirror {
  // Files keep their existing name (e.g. sample-agent.json); new agents are saved as <id>.json.
  const fileById = new Map<string, string>();

  const fileFor = (id: string) => fileById.get(id) ?? path.join(dir, `${id.replace(/[^\w.-]/g, "_")}.json`);

  return {
    dir,
    async readAll() {
      await fs.mkdir(dir, { recursive: true });
      const agents: AgentDefinition[] = [];
      for (const name of (await fs.readdir(dir)).filter((n) => n.endsWith(".json")).sort()) {
        const file = path.join(dir, name);
        try {
          const agent = JSON.parse(await fs.readFile(file, "utf8")) as AgentDefinition;
          if (typeof agent.id !== "string" || agent.id === "") throw new Error("missing id");
          fileById.set(agent.id, file);
          agents.push(agent);
        } catch (error) {
          console.warn(`[agents] skipping ${file}: ${(error as Error).message}`);
        }
      }
      return agents;
    },
    async save(agent) {
      await fs.mkdir(dir, { recursive: true });
      const file = fileFor(agent.id);
      await fs.writeFile(file, `${JSON.stringify(agent, null, 2)}\n`);
      fileById.set(agent.id, file);
    },
    async remove(id) {
      await fs.rm(fileFor(id), { force: true });
      fileById.delete(id);
    },
  };
}

/** A store that can hold agents with caller-chosen ids, e.g. the MongoDB agent store. */
export interface SyncableAgentStore extends AgentStore {
  put(agent: AgentDefinition): Promise<void>;
}

export interface SyncResult {
  toDb: number;
  toFiles: number;
}

// JSON with sorted keys, so two copies compare equal regardless of key order.
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}

/**
 * Makes the database and the JSON files identical:
 * - only in a file: copied to the database (timestamps are added, and the file is rewritten to match)
 * - only in the database: written to a file
 * - in both but different: the copy with the newer updatedAt wins; a file without updatedAt loses
 * Deletions are not inferred: an agent missing on one side is treated as new on the other.
 * Delete agents through the app, which removes both copies.
 */
export async function syncAgentFiles(db: SyncableAgentStore, mirror: AgentFileMirror): Promise<SyncResult> {
  const [fileAgents, dbAgents] = await Promise.all([mirror.readAll(), db.list()]);
  const dbById = new Map(dbAgents.map((agent) => [agent.id, agent]));
  const result: SyncResult = { toDb: 0, toFiles: 0 };

  for (const file of fileAgents) {
    const stored = dbById.get(file.id);
    dbById.delete(file.id);
    if (stored && canonical(stored) === canonical(file)) continue;

    const fileIsNewer = !stored || (!!file.updatedAt && (!stored.updatedAt || file.updatedAt > stored.updatedAt));
    if (fileIsNewer) {
      const now = new Date().toISOString();
      const agent: AgentDefinition = { createdAt: now, updatedAt: now, ...file, tools: file.tools ?? [] };
      try {
        validateAgentInput(agent);
      } catch (error) {
        console.warn(`[agents] not syncing ${file.id} to the database: ${(error as Error).message}`);
        continue;
      }
      await db.put(agent);
      result.toDb++;
      if (canonical(agent) !== canonical(file)) await mirror.save(agent); // write back added timestamps
    } else {
      await mirror.save(stored);
      result.toFiles++;
    }
  }

  // Whatever is left exists only in the database.
  for (const agent of dbById.values()) {
    await mirror.save(agent);
    result.toFiles++;
  }
  return result;
}

/**
 * Reads from `db`, syncing with the JSON files first so edits on either side show up.
 * Every write goes to `db` first, then is mirrored to the files. A failed file operation is
 * reported through `onMirrorError` but never fails the call, since the database already has the change.
 */
export function createMirroredAgentStore(
  db: SyncableAgentStore,
  mirror: AgentFileMirror,
  onMirrorError: (error: unknown) => void = (error) => console.error("[agents] file sync failed:", error),
): AgentStore & { sync(): Promise<SyncResult | undefined> } {
  const mirrorWrite = (write: Promise<void>) => write.catch(onMirrorError);

  // Coalesce overlapping syncs (e.g. several list() calls at once) into one run.
  let inFlight: Promise<SyncResult | undefined> | undefined;
  function sync() {
    inFlight ??= syncAgentFiles(db, mirror)
      .catch((error) => {
        onMirrorError(error);
        return undefined;
      })
      .finally(() => {
        inFlight = undefined;
      });
    return inFlight;
  }

  return {
    sync,
    async list() {
      await sync();
      return db.list();
    },
    get: (id) => db.get(id),
    async create(input) {
      const agent = await db.create(input);
      await mirrorWrite(mirror.save(agent));
      return agent;
    },
    async update(id, patch) {
      const agent = await db.update(id, patch);
      await mirrorWrite(mirror.save(agent));
      return agent;
    },
    async delete(id) {
      const deleted = await db.delete(id);
      await mirrorWrite(mirror.remove(id));
      return deleted;
    },
  };
}
