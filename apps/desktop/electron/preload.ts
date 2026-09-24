import { contextBridge, ipcRenderer } from "electron";
import { IPC, type AgentDraftRequest, type AgentLabApi, type AgentSource } from "./api.js";
import type { AgentInput, FlowDefinition, FlowStore, Run, TraceEvent } from "@agentlab/contracts";
import type { AsyncTelemetryStore, PersistedState } from "@agentlab/observability";

// Agents live in MongoDB or in the local agents folder, both handled by the main process.
// Telemetry exposes both the async CRUD API (for future main-process producers) and the
// load/save adapter used by the renderer's sync TelemetryStore.
const agents: AgentLabApi["agents"] = {
  list: async () => (await ipcRenderer.invoke("agents:load")).agents,
  load: (options?: { reloadLocal?: boolean }) => ipcRenderer.invoke("agents:load", options),
  get: (id: string) => ipcRenderer.invoke("agents:get", id),
  create: (input: AgentInput, source?: AgentSource) => ipcRenderer.invoke("agents:create", input, source),
  update: (id: string, patch: Partial<AgentInput>) => ipcRenderer.invoke("agents:update", id, patch),
  delete: (id: string) => ipcRenderer.invoke("agents:delete", id),
  promote: (id: string) => ipcRenderer.invoke("agents:promote", id),
  draft: (request: AgentDraftRequest) => ipcRenderer.invoke("agents:draft", request),
};

const cloudFlows: FlowStore = {
  list: () => ipcRenderer.invoke(IPC.listCloudFlows),
  get: (id: string) => ipcRenderer.invoke(IPC.getCloudFlow, id),
  save: (flow: FlowDefinition) => ipcRenderer.invoke(IPC.saveCloudFlow, flow),
  delete: (id: string) => ipcRenderer.invoke(IPC.deleteCloudFlow, id),
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

const api: AgentLabApi = {
  projects: {
    list: () => ipcRenderer.invoke(IPC.listProjects),
    create: (name) => ipcRenderer.invoke(IPC.createProject, name),
    add: () => ipcRenderer.invoke(IPC.addProjects),
    remove: (filePath) => ipcRenderer.invoke(IPC.removeProject, filePath),
    reveal: (filePath) => ipcRenderer.invoke(IPC.revealProject, filePath),
  },
  flows: {
    read: (filePath) => ipcRenderer.invoke(IPC.readFlow, filePath),
    write: (filePath, json) => ipcRenderer.invoke(IPC.writeFlow, filePath, json),
  },
  agents,
  cloudFlows,
  roles: { list: () => ipcRenderer.invoke("roles:list") },
  telemetry,
  mcp: { list: () => ipcRenderer.invoke(IPC.listMcp) },
  optimization: {
    generateJson: (request) => ipcRenderer.invoke(IPC.generateJson, request),
  },
};

contextBridge.exposeInMainWorld("agentlab", api);
