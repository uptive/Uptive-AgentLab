import { contextBridge, ipcRenderer } from "electron";
import { IPC, type AgentLabApi } from "./api.js";

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
};

contextBridge.exposeInMainWorld("agentlab", api);
