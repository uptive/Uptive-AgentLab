import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient, ServerApiVersion } from "mongodb";
import {
  DEFAULT_AGENT_ROLES,
  type AgentDefinition,
  type AgentInput,
  type AgentRunContext,
  type AgentRoleStore,
  type AgentStore,
  type FlowDefinition,
  type FlowStore,
  type Run,
  type TraceEvent,
} from "@agentlab/contracts";
import type { AsyncTelemetryStore, PersistedState } from "@agentlab/observability";
import { PERSISTED_STATE_VERSION } from "@agentlab/observability";
import { createMongoTelemetryStore } from "@agentlab/observability/mongo";
import { createMongoAgentStore, createMongoRoleStore, type MongoAgentStore } from "@agentlab/agent-runtime/mongo";
import { createFileAgentStore } from "@agentlab/agent-runtime/files";
import { createMongoFlowStore } from "@agentlab/flow-engine/mongo";
import type { JsonRequest } from "@agentlab/optimization";
import { createModelClient } from "@agentlab/optimization/models";
import { generateAgentDraft } from "./agentDraft.js";
import { createClaudeCliRuntime } from "@agentlab/agent-runtime/claude-cli";
import {
  IPC,
  type AgentDraftRequest,
  type AgentListing,
  type AgentSource,
  type ProjectEntry,
  type SourcedAgent,
  type ToolActionResult,
  type ToolOutputStream,
  type ToolRunRequest,
} from "./api.js";
import { describeFlowFile, EditorConfigStore } from "./editorConfig.js";
import { LocalToolRegistry } from "./localTools.js";
import { listMcpSources } from "./mcpConfig.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

// Minimal KEY=VALUE parser. process.loadEnvFile() crashes Electron 33's main process (SIGTRAP).
function loadEnvFile(envPath: string) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    const [, key, raw] = match;
    const value = raw.replace(/^(["'])(.*)\1$/, "$2");
    process.env[key] ??= value;
  }
}

// Load the first .env found: apps/desktop/.env, then the repo root .env.
for (const envPath of [path.resolve(__dirname, "../.env"), path.resolve(__dirname, "../../../.env")]) {
  if (existsSync(envPath)) {
    loadEnvFile(envPath);
    break;
  }
}

interface Stores {
  client: MongoClient;
  agents: MongoAgentStore;
  flows: FlowStore;
  roles: AgentRoleStore;
  telemetry: AsyncTelemetryStore;
}

let stores: Promise<Stores> | undefined;
const tools = new LocalToolRegistry();

async function connect(): Promise<Stores> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is not set. Add it to the repo root .env file.");
  }
  const client = new MongoClient(uri, {
    serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true },
    ignoreUndefined: true,
  });
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || "agentlab");
  const [agents, flows, roles, telemetry] = await Promise.all([
    createMongoAgentStore(db),
    createMongoFlowStore(db),
    createMongoRoleStore(db),
    createMongoTelemetryStore(db),
  ]);

  // Flows saved to MongoDB are independent of local flow files (no mirroring): the flows list
  // shows both sources together, and the user picks where each flow lives.
  return { client, agents, flows, roles, telemetry };
}

function getStores(): Promise<Stores> {
  stores ??= connect().catch((error) => {
    stores = undefined; // allow a retry on the next call
    throw error;
  });
  return stores;
}

// Local agents are JSON files in a git-ignored folder, read at startup and again when the renderer
// asks for a reload. They work without MongoDB.
const localAgents = createFileAgentStore(
  process.env.LOCAL_AGENTS_DIR || path.resolve(__dirname, "../../../data/local-agents"),
);
let localAgentsLoaded: Promise<void> = Promise.resolve();

function loadLocalAgents() {
  // Chained so a reload never runs alongside an earlier one.
  localAgentsLoaded = localAgentsLoaded.then(() =>
    localAgents.load().then(
      (count) => console.log(`[agents] loaded ${count} local agents from ${localAgents.dir}`),
      (error) => console.error(`[agents] could not load local agents from ${localAgents.dir}:`, error.message),
    ),
  );
  return localAgentsLoaded;
}

const tag =
  (source: AgentSource) =>
  (agent: AgentDefinition): SourcedAgent => ({ ...agent, source });

// Drops the source tag in case a caller passes a listed agent back in, so it is never stored.
function withoutSource<T extends object>(input: T): T {
  const { source: _source, ...rest } = input as T & { source?: AgentSource };
  return rest as T;
}

/** The store holding an agent: the local folder when the id is found there, otherwise MongoDB. */
async function agentStoreFor(id: string): Promise<[AgentStore, AgentSource]> {
  await localAgentsLoaded;
  if (await localAgents.get(id)) return [localAgents, "local"];
  return [(await getStores()).agents, "database"];
}

/** Adds a saved agent's role to the reusable list. Best effort, so local agents still save without MongoDB. */
async function rememberRole(role: string) {
  try {
    await (await getStores()).roles.add(role);
  } catch (error) {
    console.warn("[roles] could not save role:", (error as Error).message);
  }
}

/** The reusable roles from MongoDB, or the defaults when MongoDB is unreachable. */
async function listRoles(): Promise<string[]> {
  try {
    return await (await getStores()).roles.list();
  } catch {
    return DEFAULT_AGENT_ROLES;
  }
}

// Telemetry payload guard for the load/save bridge used by the renderer's RunPersistenceAdapter.
const MAX_TELEMETRY_BYTES = 25 * 1024 * 1024;

const JSON_FILTERS = [{ name: "Flow definition", extensions: ["json"] }];

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "flow";

function registerIpc(store: EditorConfigStore, tools: LocalToolRegistry) {
  /** Renderer may only touch files the user registered via the project view. */
  const assertRegistered = async (filePath: string) => {
    if (!(await store.isRegistered(filePath))) throw new Error(`Flow file is not registered in the project: ${filePath}`);
  };

  ipcMain.handle(IPC.listProjects, () => store.state());

  ipcMain.handle(IPC.createProject, async (_event, name: string) => {
    const trimmed = name.trim() || "Untitled flow";
    const { flowsDirectory } = await store.load();
    await mkdir(flowsDirectory, { recursive: true });

    const id = slugify(trimmed);
    const content = JSON.stringify({ id, name: trimmed, nodes: [] }, null, 2) + "\n";
    // Pick a free file name; "wx" guarantees we never overwrite an existing file.
    for (let i = 1; ; i++) {
      const filePath = path.join(flowsDirectory, i === 1 ? `${id}.json` : `${id}-${i}.json`);
      try {
        await writeFile(filePath, content, { encoding: "utf8", flag: "wx" });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "EEXIST") continue;
        throw err;
      }
      await store.register(filePath);
      return { entry: await store.entry(filePath), content };
    }
  });

  ipcMain.handle(IPC.addProjects, async (event): Promise<ProjectEntry[]> => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options = { properties: ["openFile" as const, "multiSelections" as const], filters: JSON_FILTERS };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    if (result.canceled) return [];

    const entries: ProjectEntry[] = [];
    for (const filePath of result.filePaths) {
      const entry = await describeFlowFile(filePath);
      if (entry.status !== "ok") throw new Error(`${path.basename(filePath)} is not a valid flow definition`);
      entries.push(entry);
    }
    for (const entry of entries) await store.register(entry.filePath, false);
    return entries;
  });

  ipcMain.handle(IPC.removeProject, async (_event, filePath: string) => {
    await store.unregister(filePath);
  });

  ipcMain.handle(IPC.revealProject, async (_event, filePath: string) => {
    await assertRegistered(filePath);
    shell.showItemInFolder(filePath);
  });

  ipcMain.handle(IPC.readFlow, async (_event, filePath: string) => {
    await assertRegistered(filePath);
    const content = await readFile(filePath, "utf8");
    await store.register(filePath); // bump lastOpenedAt
    return content;
  });

  ipcMain.handle(IPC.writeFlow, async (_event, filePath: string, json: string) => {
    await assertRegistered(filePath);
    await writeFile(filePath, json, "utf8");
    return store.entry(filePath);
  });

  /** Streams a run's output back to the window that started it. */
  const forwardOutput = (sender: Electron.WebContents, runId: string | undefined) =>
    runId === undefined
      ? undefined
      : (stream: ToolOutputStream, chunk: string) => {
          if (!sender.isDestroyed()) sender.send(IPC.toolOutput, { runId, stream, chunk });
        };

  ipcMain.handle(IPC.listTools, () => tools.list());
  ipcMain.handle(IPC.refreshTools, () => tools.refresh());
  ipcMain.handle(IPC.runTool, (event, request: ToolRunRequest) =>
    tools.run(request, { onOutput: forwardOutput(event.sender, request.runId) }),
  );
  ipcMain.handle(IPC.cancelTool, (_e, runId: string) => tools.cancel(runId));

  // The confirmation lives here, not in the renderer, so nothing can install without the user saying yes.
  ipcMain.handle(IPC.installTool, async (event, toolId: string, runId?: string): Promise<ToolActionResult> => {
    const command = tools.installCommand(toolId);
    const tool = (await tools.list()).find((t) => t.id === toolId);
    if (!command || !tool) throw new Error(`AgentLab cannot install "${toolId}" on this platform`);
    const win = BrowserWindow.fromWebContents(event.sender);
    const options: Electron.MessageBoxOptions = {
      type: "question",
      buttons: ["Install", "Cancel"],
      defaultId: 0,
      cancelId: 1,
      message: `Install ${tool.name}?`,
      detail: `AgentLab will download and run the official installer:\n\n${command}\n\nMore info: ${tool.docsUrl}`,
    };
    const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
    if (response !== 0) return { confirmed: false };
    return { confirmed: true, ...(await tools.install(toolId, { runId, onOutput: forwardOutput(event.sender, runId) })) };
  });

  ipcMain.handle(IPC.fixToolSetup, async (event, toolId: string, runId?: string): Promise<ToolActionResult> => ({
    confirmed: true,
    ...(await tools.fixSetup(toolId, { runId, onOutput: forwardOutput(event.sender, runId) })),
  }));

  // Agents run on the local Claude Code CLI; the flow engine in the renderer uses this as its AgentRuntime.
  const claudeRuntime = createClaudeCliRuntime({
    exec: (args, { input, cwd, timeoutMs }) => tools.run({ toolId: "claude", args, input, cwd, timeoutMs: timeoutMs ?? 10 * 60_000 }),
  });
  ipcMain.handle(IPC.runAgent, (_e, agent: AgentDefinition, input: unknown, context: AgentRunContext) =>
    claudeRuntime.run(agent, input, context),
  );

  ipcMain.handle("agents:load", async (_e, options?: { reloadLocal?: boolean }): Promise<AgentListing> => {
    await (options?.reloadLocal ? loadLocalAgents() : localAgentsLoaded);
    const local = (await localAgents.list()).map(tag("local"));
    try {
      const database = (await (await getStores()).agents.list()).map(tag("database"));
      return { agents: [...local, ...database] };
    } catch (error) {
      return { agents: local, databaseError: (error as Error).message };
    }
  });
  ipcMain.handle("agents:get", async (_e, id: string) => {
    const [store, source] = await agentStoreFor(id);
    const agent = await store.get(id);
    return agent && tag(source)(agent);
  });
  ipcMain.handle("agents:create", async (_e, input: AgentInput, source?: AgentSource) => {
    await localAgentsLoaded;
    const target: AgentSource = source === "local" ? "local" : "database";
    const store = target === "local" ? localAgents : (await getStores()).agents;
    const agent = await store.create(withoutSource(input));
    await rememberRole(agent.role);
    return tag(target)(agent);
  });
  ipcMain.handle("agents:update", async (_e, id: string, patch: Partial<AgentInput>) => {
    const [store, source] = await agentStoreFor(id);
    const agent = await store.update(id, withoutSource(patch));
    if (patch.role !== undefined) await rememberRole(agent.role);
    return tag(source)(agent);
  });
  ipcMain.handle("agents:delete", async (_e, id: string) => {
    const [store] = await agentStoreFor(id);
    return store.delete(id);
  });
  ipcMain.handle("agents:promote", async (_e, id: string) => {
    await localAgentsLoaded;
    const agent = await localAgents.get(id);
    if (!agent) throw new Error(`Local agent ${id} not found`);
    const database = (await getStores()).agents;
    const promoted = await database.insert(agent);
    try {
      if (!(await localAgents.delete(id))) throw new Error("it is no longer in the local folder");
    } catch (error) {
      // Undo the insert so the agent never ends up in both stores.
      await database.delete(id);
      throw new Error(`Could not remove the local file, so the agent was not promoted: ${(error as Error).message}`);
    }
    await rememberRole(promoted.role);
    return tag("database")(promoted);
  });
  // Roles are read here rather than passed from the renderer, so the draft always sees the current list.
  ipcMain.handle("agents:draft", async (_e, request: AgentDraftRequest) => generateAgentDraft(request, await listRoles()));
  ipcMain.handle("roles:list", () => listRoles());

  ipcMain.handle(IPC.listMcp, () =>
    listMcpSources({ appDataDir: app.getPath("appData"), repoRoot: path.resolve(__dirname, "../../..") }),
  );

  // Model calls for LLM-backed evaluators run here. AGENT_BACKEND=cli (default) uses the local
  // Claude Code CLI and your Claude.ai subscription; AGENT_BACKEND=api uses the Anthropic API.
  const modelClient = createModelClient();
  console.log(`[optimize] model backend: ${process.env.AGENT_BACKEND ?? "cli"}`);
  ipcMain.handle(IPC.generateJson, (_e, request: JsonRequest) => modelClient.generateJson(request));

  ipcMain.handle(IPC.listCloudFlows, async () => (await getStores()).flows.list());
  ipcMain.handle(IPC.getCloudFlow, async (_e, id: string) => (await getStores()).flows.get(id));
  ipcMain.handle(IPC.saveCloudFlow, async (_e, flow: FlowDefinition) => (await getStores()).flows.save(flow));
  ipcMain.handle(IPC.deleteCloudFlow, async (_e, id: string) => (await getStores()).flows.delete(id));

  ipcMain.handle("telemetry:recordEvent", async (_e, event: TraceEvent) => (await getStores()).telemetry.recordEvent(event));
  ipcMain.handle("telemetry:listEvents", async (_e, runId: string) => (await getStores()).telemetry.listEvents(runId));
  ipcMain.handle("telemetry:saveRun", async (_e, run: Run) => (await getStores()).telemetry.saveRun(run));
  ipcMain.handle("telemetry:getRun", async (_e, runId: string) => (await getStores()).telemetry.getRun(runId));
  ipcMain.handle("telemetry:listRuns", async () => (await getStores()).telemetry.listRuns());

  // Renderer RunPersistenceAdapter bridge: load returns a full snapshot the sync
  // TelemetryStore can hydrate from; save replays runs+events into Mongo.
  ipcMain.handle("telemetry:load", async (): Promise<PersistedState | null> => {
    try {
      const { telemetry } = await getStores();
      const runs = await telemetry.listRuns();
      const eventArrays = await Promise.all(runs.map((run) => telemetry.listEvents(run.id)));
      return { version: PERSISTED_STATE_VERSION, runs, events: eventArrays.flat() };
    } catch (err) {
      console.warn("[telemetry] load failed, returning empty state:", (err as Error).message);
      return null;
    }
  });

  ipcMain.handle("telemetry:save", async (_e, payload: PersistedState) => {
    if (!payload || payload.version !== PERSISTED_STATE_VERSION) return;
    const serialized = JSON.stringify(payload);
    if (serialized.length > MAX_TELEMETRY_BYTES) {
      throw new Error(`telemetry:save payload exceeds ${MAX_TELEMETRY_BYTES} bytes`);
    }
    try {
      const { telemetry } = await getStores();
      await Promise.all(payload.runs.map((run) => telemetry.saveRun(run)));
      await Promise.all(payload.events.map((event) => telemetry.recordEvent(event)));
    } catch (err) {
      console.warn("[telemetry] save failed:", (err as Error).message);
    }
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Links with target="_blank" open in the user's browser instead of a new app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

app.whenReady().then(() => {
  const store = new EditorConfigStore(
    path.join(app.getPath("userData"), "editor-config.json"),
    path.join(app.getPath("documents"), "AgentLab", "Flows"),
  );
  void loadLocalAgents();
  registerIpc(store, tools);
  tools.list().then(
    (found) => console.log(`[tools] ${found.filter((t) => t.installed).map((t) => t.id).join(", ") || "none"} available`),
    (error) => console.error("[tools] detection failed:", error.message),
  );
  getStores().then(
    () => console.log("[db] connected to MongoDB"),
    (error) => console.error("[db] MongoDB connection failed:", error.message),
  );
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on("before-quit", () => {
  tools.dispose();
  stores?.then(({ client }) => client.close()).catch(() => {});
});
