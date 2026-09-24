import { contextBridge, ipcRenderer } from "electron";
import { IPC, type AgentLabApi } from "./api.js";

const api: AgentLabApi = {
  flows: {
    list: () => ipcRenderer.invoke(IPC.listFlows),
    read: (id) => ipcRenderer.invoke(IPC.readFlow, id),
    save: (id, json) => ipcRenderer.invoke(IPC.saveFlow, id, json),
    delete: (id) => ipcRenderer.invoke(IPC.deleteFlow, id),
  },
};

contextBridge.exposeInMainWorld("agentlab", api);
