import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { IPC, type ProjectEntry } from "./api.js";
import { describeFlowFile, EditorConfigStore } from "./editorConfig.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

const JSON_FILTERS = [{ name: "Flow definition", extensions: ["json"] }];

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "flow";

function registerIpc(store: EditorConfigStore) {
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
  const store = new EditorConfigStore(
    path.join(app.getPath("userData"), "editor-config.json"),
    path.join(app.getPath("documents"), "AgentLab", "Flows"),
  );
  registerIpc(store);
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
