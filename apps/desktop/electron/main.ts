import { app, BrowserWindow, ipcMain } from "electron";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { IPC, type FlowSummary } from "./api.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

function flowsDir(): string {
  return path.join(app.getPath("userData"), "flows");
}

async function ensureFlowsDir(): Promise<string> {
  const dir = flowsDir();
  await mkdir(dir, { recursive: true });
  return dir;
}

function flowFilePath(id: string): string {
  const safe = id.replace(/[^\w.-]+/g, "-") || "flow";
  return path.join(flowsDir(), `${safe}.json`);
}

function registerIpc() {
  ipcMain.handle(IPC.listFlows, async (): Promise<FlowSummary[]> => {
    const dir = await ensureFlowsDir();
    const files = await readdir(dir);
    const summaries: FlowSummary[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const filePath = path.join(dir, file);
      try {
        const [content, stats] = await Promise.all([readFile(filePath, "utf8"), stat(filePath)]);
        const parsed = JSON.parse(content);
        summaries.push({
          id: typeof parsed.id === "string" ? parsed.id : file.replace(/\.json$/, ""),
          name: typeof parsed.name === "string" ? parsed.name : file,
          description: typeof parsed.description === "string" ? parsed.description : undefined,
          updatedAt: stats.mtime.toISOString(),
        });
      } catch {
        // skip unreadable/corrupt files
      }
    }
    summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return summaries;
  });

  ipcMain.handle(IPC.readFlow, async (_event, id: string): Promise<string> => {
    return readFile(flowFilePath(id), "utf8");
  });

  ipcMain.handle(IPC.saveFlow, async (_event, id: string, json: string): Promise<void> => {
    await ensureFlowsDir();
    await writeFile(flowFilePath(id), json, "utf8");
  });

  ipcMain.handle(IPC.deleteFlow, async (_event, id: string): Promise<void> => {
    await rm(flowFilePath(id), { force: true });
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      // vite-plugin-electron emits the (CommonJS) preload as preload.mjs.
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
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
