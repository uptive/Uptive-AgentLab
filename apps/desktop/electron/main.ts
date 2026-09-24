import { app, BrowserWindow, ipcMain } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

// Local storage for the workshop's runs + trace events (Group 3 - Runs & Observability).
const MAX_TELEMETRY_BYTES = 25 * 1024 * 1024;
const telemetryFilePath = () => path.join(app.getPath("userData"), "telemetry.json");

function registerTelemetryIpc(): void {
  ipcMain.removeHandler("telemetry:load");
  ipcMain.removeHandler("telemetry:save");

  ipcMain.handle("telemetry:load", async () => {
    try {
      const raw = await fs.readFile(telemetryFilePath(), "utf-8");
      return JSON.parse(raw);
    } catch {
      return null;
    }
  });

  ipcMain.handle("telemetry:save", async (_event: Electron.IpcMainInvokeEvent, payload: unknown) => {
    const serialized = JSON.stringify(payload);
    if (serialized.length > MAX_TELEMETRY_BYTES) {
      throw new Error(`telemetry:save payload exceeds ${MAX_TELEMETRY_BYTES} bytes`);
    }
    const finalPath = telemetryFilePath();
    const tmpPath = `${finalPath}.${process.pid}.tmp`;
    await fs.writeFile(tmpPath, serialized, "utf-8");
    await fs.rename(tmpPath, finalPath);
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

app.whenReady().then(() => {
  registerTelemetryIpc();
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
