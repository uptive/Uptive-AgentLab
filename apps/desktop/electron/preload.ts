// Typed IPC bridge for main-process access (e.g. local file storage for Runs).
import { contextBridge, ipcRenderer } from "electron";
import type { PersistedState } from "@agentlab/observability";

contextBridge.exposeInMainWorld("agentlab", {
  telemetry: {
    load: (): Promise<PersistedState | null> => ipcRenderer.invoke("telemetry:load"),
    save: (state: PersistedState): Promise<void> => ipcRenderer.invoke("telemetry:save", state),
  },
});

