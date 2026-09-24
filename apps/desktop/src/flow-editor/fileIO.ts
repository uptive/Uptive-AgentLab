/**
 * CRUD storage for flow entities. Uses the Electron bridge when available and
 * falls back to localStorage when the renderer runs outside Electron.
 */
import type { FlowSummary } from "../../electron/api.js";

export type { FlowSummary };

const LOCAL_PREFIX = "agentlab:flow:";

interface LocalRecord {
  content: string;
  updatedAt: string;
}

const localKey = (id: string) => `${LOCAL_PREFIX}${id}`;

function readLocalRecord(id: string): LocalRecord | undefined {
  const raw = localStorage.getItem(localKey(id));
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as LocalRecord;
  } catch {
    return undefined;
  }
}

function readLocalSummaries(): FlowSummary[] {
  const summaries: FlowSummary[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(LOCAL_PREFIX)) continue;
    const id = key.slice(LOCAL_PREFIX.length);
    const record = readLocalRecord(id);
    if (!record) continue;
    try {
      const parsed = JSON.parse(record.content);
      summaries.push({
        id: typeof parsed.id === "string" ? parsed.id : id,
        name: typeof parsed.name === "string" ? parsed.name : id,
        description: typeof parsed.description === "string" ? parsed.description : undefined,
        updatedAt: record.updatedAt,
      });
    } catch {
      // skip corrupt entry
    }
  }
  return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function listFlows(): Promise<FlowSummary[]> {
  if (window.agentlab) return window.agentlab.flows.list();
  return readLocalSummaries();
}

export async function readFlow(id: string): Promise<string> {
  if (window.agentlab) return window.agentlab.flows.read(id);
  const record = readLocalRecord(id);
  if (!record) throw new Error(`Flow "${id}" not found`);
  return record.content;
}

export async function saveFlow(id: string, json: string): Promise<void> {
  if (window.agentlab) return window.agentlab.flows.save(id, json);
  const record: LocalRecord = { content: json, updatedAt: new Date().toISOString() };
  localStorage.setItem(localKey(id), JSON.stringify(record));
}

export async function deleteFlow(id: string): Promise<void> {
  if (window.agentlab) return window.agentlab.flows.delete(id);
  localStorage.removeItem(localKey(id));
}
