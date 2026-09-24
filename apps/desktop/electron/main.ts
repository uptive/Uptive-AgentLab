import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { IPC, type OpenFlowResult, type SaveFlowResult } from "./api.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

const JSON_FILTERS = [{ name: "Flow definition", extensions: ["json"] }];

/** Paths the user explicitly picked via a dialog; only these may be overwritten silently. */
const userSelectedPaths = new Set<string>();

function registerIpc() {
  ipcMain.handle(
    IPC.saveFlow,
    async (event, json: string, options: { suggestedName: string; filePath?: string }): Promise<SaveFlowResult> => {
      let filePath = options.filePath && userSelectedPaths.has(options.filePath) ? options.filePath : undefined;
      if (!filePath) {
        const win = BrowserWindow.fromWebContents(event.sender);
        const safeName = options.suggestedName.replace(/[^\w.-]+/g, "-") || "flow";
        const dialogOptions = {
          defaultPath: path.join(app.getPath("documents"), `${safeName}.json`),
          filters: JSON_FILTERS,
        };
        const result = win ? await dialog.showSaveDialog(win, dialogOptions) : await dialog.showSaveDialog(dialogOptions);
        if (result.canceled || !result.filePath) return { canceled: true };
        filePath = result.filePath;
        userSelectedPaths.add(filePath);
      }
      await writeFile(filePath, json, "utf8");
      return { canceled: false, filePath };
    },
  );

  ipcMain.handle(IPC.openFlow, async (event): Promise<OpenFlowResult> => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const dialogOptions = { properties: ["openFile" as const], filters: JSON_FILTERS };
    const result = win ? await dialog.showOpenDialog(win, dialogOptions) : await dialog.showOpenDialog(dialogOptions);
    if (result.canceled || result.filePaths.length === 0) return { canceled: true };
    const filePath = result.filePaths[0];
    userSelectedPaths.add(filePath);
    return { canceled: false, filePath, content: await readFile(filePath, "utf8") };
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
