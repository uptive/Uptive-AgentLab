import { contextBridge, ipcRenderer } from "electron";
import { IPC, type AgentLabApi } from "./api.js";
import type { IpcRendererEvent } from "electron";
import type { AgentInput, AgentStore, Run, TraceEvent } from "@agentlab/contracts";
import type { AsyncTelemetryStore, PersistedState } from "@agentlab/observability";

// Agents live in MongoDB via the main process. Telemetry exposes both the async CRUD
// API (for future main-process producers) and the load/save adapter used by the
// renderer's sync TelemetryStore.
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

/** Subscribes to a main-process push channel; returns the unsubscribe function. */
function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T) => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

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
  telemetry,
  runs: {
    start: (request) => ipcRenderer.invoke(IPC.startRun, request),
    cancel: (runId) => ipcRenderer.invoke(IPC.cancelRun, runId),
    onUpdate: (listener) => subscribe(IPC.runUpdate, listener),
    onEvent: (listener) => subscribe(IPC.runEvent, listener),
    pickFolder: () => ipcRenderer.invoke(IPC.pickFolder),
  },
  claude: {
    authStatus: (refresh) => ipcRenderer.invoke(IPC.authStatus, refresh),
    builtinAgents: () => ipcRenderer.invoke(IPC.builtinAgents),
  },
  skills: {
    list: () => ipcRenderer.invoke(IPC.listSkills),
    save: (skill) => ipcRenderer.invoke(IPC.saveSkill, skill),
    delete: (name) => ipcRenderer.invoke(IPC.deleteSkill, name),
    reveal: (name) => ipcRenderer.invoke(IPC.revealSkill, name),
    import: () => ipcRenderer.invoke(IPC.importSkills),
  },
  mcpServers: {
    list: () => ipcRenderer.invoke(IPC.listMcpServers),
    save: (input, secret) => ipcRenderer.invoke(IPC.saveMcpServer, input, secret),
    delete: (id) => ipcRenderer.invoke(IPC.deleteMcpServer, id),
    test: (id) => ipcRenderer.invoke(IPC.testMcpServer, id),
    importClaudeDesktop: () => ipcRenderer.invoke(IPC.importClaudeDesktop),
  },
  optimization: {
    generateJson: (request) => ipcRenderer.invoke(IPC.generateJson, request),
  },
};

contextBridge.exposeInMainWorld("agentlab", api);
