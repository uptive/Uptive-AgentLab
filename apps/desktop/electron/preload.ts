import { contextBridge, ipcRenderer } from "electron";
import { IPC, type AgentLabApi } from "./api.js";

const api: AgentLabApi = {
  flows: {
    save: (json, options) => ipcRenderer.invoke(IPC.saveFlow, json, options),
    open: () => ipcRenderer.invoke(IPC.openFlow),
  },
};

contextBridge.exposeInMainWorld("agentlab", api);
