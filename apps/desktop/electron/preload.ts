import { contextBridge, ipcRenderer } from "electron";
import type { AgentInput, AgentStore, Run, TraceEvent } from "@agentlab/contracts";
import type { TelemetryStore } from "@agentlab/observability";

// Typed IPC bridge. Data is persisted to MongoDB by the main process.
const agents: AgentStore = {
  list: () => ipcRenderer.invoke("agents:list"),
  get: (id: string) => ipcRenderer.invoke("agents:get", id),
  create: (input: AgentInput) => ipcRenderer.invoke("agents:create", input),
  update: (id: string, patch: Partial<AgentInput>) => ipcRenderer.invoke("agents:update", id, patch),
  delete: (id: string) => ipcRenderer.invoke("agents:delete", id),
};

const telemetry: TelemetryStore = {
  recordEvent: (event: TraceEvent) => ipcRenderer.invoke("telemetry:recordEvent", event),
  listEvents: (runId: string) => ipcRenderer.invoke("telemetry:listEvents", runId),
  saveRun: (run: Run) => ipcRenderer.invoke("telemetry:saveRun", run),
  getRun: (runId: string) => ipcRenderer.invoke("telemetry:getRun", runId),
  listRuns: () => ipcRenderer.invoke("telemetry:listRuns"),
};

const api = { agents, telemetry };

export type AgentLabApi = typeof api;

contextBridge.exposeInMainWorld("agentlab", api);
