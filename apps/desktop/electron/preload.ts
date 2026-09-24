import { contextBridge, ipcRenderer } from "electron";
import type { AgentInput, AgentStore, Run, TraceEvent } from "@agentlab/contracts";
import type { AsyncTelemetryStore, PersistedState } from "@agentlab/observability";

// Typed IPC bridge. Agents live in MongoDB via the main process. Telemetry exposes
// both the async CRUD API (for future main-process producers) and the load/save
// adapter used by the renderer's sync TelemetryStore.
const agents: AgentStore = {
  list: () => ipcRenderer.invoke("agents:list"),
  get: (id: string) => ipcRenderer.invoke("agents:get", id),
  create: (input: AgentInput) => ipcRenderer.invoke("agents:create", input),
  update: (id: string, patch: Partial<AgentInput>) => ipcRenderer.invoke("agents:update", id, patch),
  delete: (id: string) => ipcRenderer.invoke("agents:delete", id),
};

const telemetry: AsyncTelemetryStore & {
  load: () => Promise<PersistedState | null>;
  save: (state: PersistedState) => Promise<void>;
} = {
  recordEvent: (event: TraceEvent) => ipcRenderer.invoke("telemetry:recordEvent", event),
  listEvents: (runId: string) => ipcRenderer.invoke("telemetry:listEvents", runId),
  saveRun: (run: Run) => ipcRenderer.invoke("telemetry:saveRun", run),
  getRun: (runId: string) => ipcRenderer.invoke("telemetry:getRun", runId),
  listRuns: () => ipcRenderer.invoke("telemetry:listRuns"),
  load: () => ipcRenderer.invoke("telemetry:load"),
  save: (state: PersistedState) => ipcRenderer.invoke("telemetry:save", state),
};

const api = { agents, telemetry };

export type AgentLabApi = typeof api;

contextBridge.exposeInMainWorld("agentlab", api);
