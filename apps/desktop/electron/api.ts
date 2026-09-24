/** Shared contract for the preload bridge (`window.agentlab`). Types only + channel names. */

import type {
  AgentDefinition,
  AgentInput,
  AgentStore,
  FlowDefinition,
  McpServerDefinition,
  McpServerInput,
  Run,
  SkillDefinition,
  TraceEvent,
} from "@agentlab/contracts";
import type { ClaudeAuthStatus, McpTestResult } from "@agentlab/agent-runtime/claude";
import type { AsyncTelemetryStore, PersistedState } from "@agentlab/observability";
import type { JsonRequest } from "@agentlab/optimization";

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

export interface StartRunRequest {
  flow: FlowDefinition;
  input: unknown;
  /** A folder agents may read (e.g. the repository a review flow looks at). */
  folder?: string;
}

export interface McpServerEntry extends McpServerDefinition {
  /** Whether the secret this server references is stored on this computer. */
  hasSecret: boolean;
}

export interface ImportResult {
  imported: string[];
  skipped: { name: string; reason: string }[];
}

export type { ClaudeAuthStatus, McpTestResult };

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
  /** Real flow runs, executed by the Claude runtime in the main process. */
  runs: {
    /** Resolves as soon as the run has started. Progress arrives through onUpdate/onEvent. */
    start(request: StartRunRequest): Promise<{ runId: string }>;
    cancel(runId: string): Promise<void>;
    /** Subscribes to run snapshots; returns an unsubscribe function. */
    onUpdate(listener: (run: Run) => void): () => void;
    onEvent(listener: (event: TraceEvent) => void): () => void;
    /** Opens a folder picker; undefined when cancelled. */
    pickFolder(): Promise<string | undefined>;
  };
  claude: {
    authStatus(refresh?: boolean): Promise<ClaudeAuthStatus>;
    /** Agents that are always available to flows, in addition to saved agents. */
    builtinAgents(): Promise<AgentDefinition[]>;
  };
  skills: {
    list(): Promise<SkillDefinition[]>;
    save(skill: SkillDefinition): Promise<SkillDefinition>;
    delete(name: string): Promise<boolean>;
    reveal(name: string): Promise<void>;
    /** Lets the user pick skill folders (each with a SKILL.md) and copies them into the library. */
    import(): Promise<ImportResult>;
  };
  mcpServers: {
    list(): Promise<McpServerEntry[]>;
    /** `secret`: a new value to store, null to remove the stored one, undefined to keep it. */
    save(input: McpServerInput, secret?: string | null): Promise<McpServerEntry>;
    delete(id: string): Promise<boolean>;
    test(id: string): Promise<McpTestResult>;
    importClaudeDesktop(): Promise<ImportResult>;
  };
  /** Model calls for LLM-backed evaluators; run in the main process so API credentials stay there. */
  optimization: {
    generateJson(request: JsonRequest): Promise<unknown>;
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
  generateJson: "optimization:generate-json",
  startRun: "runs:start",
  cancelRun: "runs:cancel",
  runUpdate: "runs:update",
  runEvent: "runs:event",
  pickFolder: "runs:pick-folder",
  authStatus: "claude:auth-status",
  builtinAgents: "claude:builtin-agents",
  listSkills: "skills:list",
  saveSkill: "skills:save",
  deleteSkill: "skills:delete",
  revealSkill: "skills:reveal",
  importSkills: "skills:import",
  listMcpServers: "mcp:list",
  saveMcpServer: "mcp:save",
  deleteMcpServer: "mcp:delete",
  testMcpServer: "mcp:test",
  importClaudeDesktop: "mcp:import-claude-desktop",
} as const;
