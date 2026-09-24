import { app, BrowserWindow, ipcMain } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient, ServerApiVersion } from "mongodb";
import type { AgentInput, AgentStore, Run, TraceEvent } from "@agentlab/contracts";
import type { TelemetryStore } from "@agentlab/observability";
import { createMongoTelemetryStore } from "@agentlab/observability/mongo";
import { createMongoAgentStore } from "@agentlab/agent-runtime/mongo";
import { createAgentFileMirror, createMirroredAgentStore } from "@agentlab/agent-runtime/files";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

// Minimal KEY=VALUE parser. process.loadEnvFile() crashes Electron 33's main process (SIGTRAP).
function loadEnvFile(envPath: string) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    const [, key, raw] = match;
    const value = raw.replace(/^(["'])(.*)\1$/, "$2");
    process.env[key] ??= value;
  }
}

// Load the first .env found: apps/desktop/.env, then the repo root .env.
for (const envPath of [path.resolve(__dirname, "../.env"), path.resolve(__dirname, "../../../.env")]) {
  if (fs.existsSync(envPath)) {
    loadEnvFile(envPath);
    break;
  }
}

interface Stores {
  client: MongoClient;
  agents: AgentStore;
  telemetry: TelemetryStore;
}

let stores: Promise<Stores> | undefined;

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
  const [mongoAgents, telemetry] = await Promise.all([createMongoAgentStore(db), createMongoTelemetryStore(db)]);

  // Agents are read from MongoDB and kept in two-way sync with JSON files in data/agents/ (which
  // can be committed). The sync runs now and again whenever the agent list is loaded.
  const mirror = createAgentFileMirror(process.env.AGENTS_DIR || path.resolve(__dirname, "../../../data/agents"));
  const agents = createMirroredAgentStore(mongoAgents, mirror);
  const synced = await agents.sync();
  if (synced) console.log(`[agents] synced ${mirror.dir}: ${synced.toDb} to database, ${synced.toFiles} to files`);

  return { client, agents, telemetry };
}

function getStores(): Promise<Stores> {
  stores ??= connect().catch((error) => {
    stores = undefined; // allow a retry on the next call
    throw error;
  });
  return stores;
}

function registerIpc() {
  ipcMain.handle("agents:list", async () => (await getStores()).agents.list());
  ipcMain.handle("agents:get", async (_e, id: string) => (await getStores()).agents.get(id));
  ipcMain.handle("agents:create", async (_e, input: AgentInput) => (await getStores()).agents.create(input));
  ipcMain.handle("agents:update", async (_e, id: string, patch: Partial<AgentInput>) =>
    (await getStores()).agents.update(id, patch),
  );
  ipcMain.handle("agents:delete", async (_e, id: string) => (await getStores()).agents.delete(id));

  ipcMain.handle("telemetry:recordEvent", async (_e, event: TraceEvent) => (await getStores()).telemetry.recordEvent(event));
  ipcMain.handle("telemetry:listEvents", async (_e, runId: string) => (await getStores()).telemetry.listEvents(runId));
  ipcMain.handle("telemetry:saveRun", async (_e, run: Run) => (await getStores()).telemetry.saveRun(run));
  ipcMain.handle("telemetry:getRun", async (_e, runId: string) => (await getStores()).telemetry.getRun(runId));
  ipcMain.handle("telemetry:listRuns", async () => (await getStores()).telemetry.listRuns());
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

app.whenReady().then(() => {
  registerIpc();
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
  stores?.then(({ client }) => client.close()).catch(() => {});
});
