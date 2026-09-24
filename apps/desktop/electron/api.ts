/** Shared contract for the preload bridge (`window.agentlab`). Types only + channel names. */

import type { AgentInput, AgentStore, Run, TraceEvent } from "@agentlab/contracts";
import type { AsyncTelemetryStore, PersistedState } from "@agentlab/observability";

/** A flow file registered in the editor configuration. */
export interface ProjectEntry {
  filePath: string;
  /** Read from the file; undefined when the file is missing or unreadable. */
  id?: string;
  name?: string;
  description?: string;
  nodeCount?: number;
  modifiedAt?: string;
  lastOpenedAt?: string;
  /** "missing" = file no longer exists, "invalid" = not a readable flow document. */
  status: "ok" | "missing" | "invalid";
}

export interface ProjectsState {
  configPath: string;
  flowsDirectory: string;
  flows: ProjectEntry[];
}

export interface AgentLabApi {
  projects: {
    list(): Promise<ProjectsState>;
    /** Creates an empty flow file in the flows directory and registers it. */
    create(name: string): Promise<{ entry: ProjectEntry; content: string }>;
    /** Lets the user pick existing flow JSON files and registers them. */
    add(): Promise<ProjectEntry[]>;
    /** Unregisters a flow (the file itself is kept). */
    remove(filePath: string): Promise<void>;
    reveal(filePath: string): Promise<void>;
  };
  flows: {
    /** Reads a registered flow file and marks it as recently opened. */
    read(filePath: string): Promise<string>;
    /** Writes a registered flow file. */
    write(filePath: string, json: string): Promise<ProjectEntry>;
  };
  agents: AgentStore;
  /** Telemetry CRUD plus the load/save snapshot adapter used by the renderer's sync TelemetryStore. */
  telemetry: AsyncTelemetryStore & {
    load(): Promise<PersistedState | null>;
    save(state: PersistedState): Promise<void>;
  };
}

export const IPC = {
  listProjects: "projects:list",
  createProject: "projects:create",
  addProjects: "projects:add",
  removeProject: "projects:remove",
  revealProject: "projects:reveal",
  readFlow: "flows:read",
  writeFlow: "flows:write",
} as const;
