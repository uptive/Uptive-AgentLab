/** Shared contract for the preload bridge (`window.agentlab`). Types only + channel names. */

import type { AgentDefinition, AgentInput, Run, TraceEvent } from "@agentlab/contracts";
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

/** Where an agent is stored: a JSON file in the git-ignored local folder, or MongoDB. */
export type AgentSource = "local" | "database";

export type SourcedAgent = AgentDefinition & { source: AgentSource };

export interface AgentListing {
  agents: SourcedAgent[];
  /** Set when MongoDB could not be reached; local agents are still listed. */
  databaseError?: string;
}

/** Satisfies the AgentStore contract; each agent is tagged with the store it lives in. */
export interface AgentsApi {
  /** Local and database agents together. Database agents are left out when MongoDB is unreachable. */
  list(): Promise<SourcedAgent[]>;
  /** Like list(), but also reports why database agents are missing. `reloadLocal` re-reads the local folder first. */
  load(options?: { reloadLocal?: boolean }): Promise<AgentListing>;
  get(id: string): Promise<SourcedAgent | undefined>;
  /** Saves to MongoDB unless `source` is "local". */
  create(input: AgentInput, source?: AgentSource): Promise<SourcedAgent>;
  /** Updates and deletes go to whichever store holds the agent. */
  update(id: string, patch: Partial<AgentInput>): Promise<SourcedAgent>;
  delete(id: string): Promise<boolean>;
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
  agents: AgentsApi;
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
