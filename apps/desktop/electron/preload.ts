import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";
import { IPC, type AgentDraftRequest, type AgentLabApi, type AgentSource, type ToolOutputStream } from "./api.js";
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

/** Subscribes to a main-process push channel; returns the unsubscribe function. */
function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T) => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

type OutputListener = (stream: ToolOutputStream, chunk: string) => void;

/** Calls `invoke` with a fresh runId and routes that run's streamed output to `onOutput` until it settles. */
function withOutput<T>(onOutput: OutputListener, invoke: (runId: string) => Promise<T>) {
  const runId = crypto.randomUUID();
  const listener = (_e: Electron.IpcRendererEvent, event: { runId: string; stream: ToolOutputStream; chunk: string }) => {
    if (event.runId === runId) onOutput(event.stream, event.chunk);
  };
  ipcRenderer.on(IPC.toolOutput, listener);
  const done = invoke(runId).finally(() => ipcRenderer.removeListener(IPC.toolOutput, listener));
  return { runId, done };
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
  cloudFlows,
  roles: { list: () => ipcRenderer.invoke("roles:list") },
  tools: {
    list: () => ipcRenderer.invoke(IPC.listTools),
    refresh: () => ipcRenderer.invoke(IPC.refreshTools),
    run: (request) => ipcRenderer.invoke(IPC.runTool, request),
    start: (request, onOutput) => {
      const { runId, done } = withOutput(onOutput, (id) => ipcRenderer.invoke(IPC.runTool, { ...request, runId: id }));
      return { runId, done, cancel: () => ipcRenderer.invoke(IPC.cancelTool, runId) };
    },
    install: (toolId, onOutput) => withOutput(onOutput, (id) => ipcRenderer.invoke(IPC.installTool, toolId, id)).done,
    fixSetup: (toolId, onOutput) => withOutput(onOutput, (id) => ipcRenderer.invoke(IPC.fixToolSetup, toolId, id)).done,
  },
  runtime: {
    run: (agent, input, context) => ipcRenderer.invoke(IPC.runAgent, agent, input, context),
  },
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
  mcp: { list: () => ipcRenderer.invoke(IPC.listMcp) },
  optimization: {
    generateJson: (request) => ipcRenderer.invoke(IPC.generateJson, request),
  },
};

contextBridge.exposeInMainWorld("agentlab", api);
