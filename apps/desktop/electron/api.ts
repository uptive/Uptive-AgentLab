/** Shared contract for the preload bridge (`window.agentlab`). Types only + channel names. */

import type { AgentDefinition, AgentInput, AgentRuntime, FlowStore, Run, TraceEvent } from "@agentlab/contracts";
import type { AsyncTelemetryStore, PersistedState } from "@agentlab/observability";
import type { JsonRequest } from "@agentlab/optimization";

/** A flow file registered in the editor configuration. */
export interface ProjectEntry {
  filePath: string;
  /** Read from the file; undefined when the file is missing or unreadable. */
  id?: string;
  name?: string;
  description?: string;
  tags?: string[];
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
  /**
   * Moves a local agent to MongoDB under the same id, so flows that use it keep working, and
   * deletes its file from the local folder. Nothing changes if either step fails.
   */
  promote(id: string): Promise<SourcedAgent>;
}

export interface AgentDraftRequest {
  /** Free-text description of what the agent should achieve. */
  description: string;
  /** Model ids the draft may pick from. */
  models: string[];
}

/** Agent fields proposed by Claude from a free-text description; reviewed in the form before applying. */
export interface AgentDraft {
  name: string;
  description: string;
  role: string;
  systemInstructions: string;
  model: string;
  temperature: number;
  maxTokens: number;
  tools: { name: string; kind: "mcp" | "function" }[];
  inputSchema: unknown;
  outputSchema: unknown;
}

export type McpSourceKind = "claude-desktop" | "claude-code" | "plugin" | "project" | "cursor";

/** One configured MCP server. Env and header values are never exposed, only their names. */
export interface McpServerEntry {
  name: string;
  transport: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  url?: string;
  envKeys: string[];
  headerKeys: string[];
  disabled?: boolean;
  /** Set for Claude Desktop extensions. */
  version?: string;
}

/** A config file (or folder) that declares MCP servers. */
export interface McpSource {
  kind: McpSourceKind;
  label: string;
  path: string;
  /** "missing" = file does not exist, "invalid" = unreadable or not JSON. */
  status: "ok" | "missing" | "invalid";
  error?: string;
  servers: McpServerEntry[];
}

/** A command-line tool the app knows about, and whether it was found on this machine. */
export interface LocalTool {
  id: string;
  name: string;
  description: string;
  /** Executable name looked up on PATH. */
  command: string;
  /** True when the executable was found and answered its version check. */
  installed: boolean;
  /** Absolute path of the executable, when found. */
  path?: string;
  /** First line of the version output. */
  version?: string;
  /** Set when the executable was found but the version check failed. */
  error?: string;
  /** Install command or download page for this platform. */
  installHint: string;
  docsUrl: string;
  /** True when the app can run the official installer for the user on this platform. */
  canInstall: boolean;
  /** For installed tools that need more than installing, e.g. signing in. */
  setup?: { ready: boolean; detail: string; fixLabel: string };
}

export interface ToolActionResult {
  /** False when the user declined the confirmation dialog. */
  confirmed: boolean;
  result?: ToolRunResult;
  /** The tool as detected afterwards. */
  tool?: LocalTool;
}

export type ToolOutputStream = "stdout" | "stderr";

export interface ToolRunRequest {
  toolId: string;
  /** Caller-chosen id that makes the run cancellable and streams its output. Set by `tools.start`. */
  runId?: string;
  /**
   * Passed to the executable unchanged. No shell is involved, except for Windows .cmd shims,
   * which are escaped for cmd.exe and cannot take arguments containing line breaks.
   */
  args: string[];
  cwd?: string;
  /** Written to stdin, which is then closed. */
  input?: string;
  /** Defaults to 2 minutes, capped at 10. */
  timeoutMs?: number;
}

export interface ToolRunResult {
  toolId: string;
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  cancelled: boolean;
  /** True when stdout or stderr went past 1M characters and was cut off. */
  truncated: boolean;
}

export interface ToolRun {
  runId: string;
  /** Settles when the process exits; rejects if it could not start. */
  done: Promise<ToolRunResult>;
  cancel(): Promise<boolean>;
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
  agents: AgentsApi & {
    /** Asks the claude CLI to map a description into agent fields. Nothing is saved. */
    draft(request: AgentDraftRequest): Promise<AgentDraft>;
  };
  /** Flows saved to MongoDB. Independent of the local file flows above — not synced with them. */
  cloudFlows: FlowStore;
  roles: {
    /** Reusable role names, persisted in MongoDB. */
    list(): Promise<string[]>;
  };
  /** Command-line tools installed on this machine that AgentLab depends on (Claude Code). */
  tools: {
    /** Detected tools; cached after the first call. */
    list(): Promise<LocalTool[]>;
    /** Re-detects, e.g. after the user installed something. */
    refresh(): Promise<LocalTool[]>;
    /** Runs a known tool and waits for it. Throws if the tool is unknown or not installed. */
    run(request: ToolRunRequest): Promise<ToolRunResult>;
    /** Asks the user to confirm, then runs the tool's official installer. Output streams to `onOutput`. */
    install(toolId: string, onOutput: (stream: ToolOutputStream, chunk: string) => void): Promise<ToolActionResult>;
    /** Runs the tool's setup step (e.g. `claude auth login`). Output streams to `onOutput`. */
    fixSetup(toolId: string, onOutput: (stream: ToolOutputStream, chunk: string) => void): Promise<ToolActionResult>;
    /** Starts a run that streams its output and can be cancelled. */
    start(request: Omit<ToolRunRequest, "runId">, onOutput: (stream: ToolOutputStream, chunk: string) => void): ToolRun;
  };
  /** Runs agents on the local Claude Code CLI; plug into `createFlowEngine({ runtime })`. */
  runtime: AgentRuntime;
  /** Telemetry CRUD plus the load/save snapshot adapter used by the renderer's sync TelemetryStore. */
  telemetry: AsyncTelemetryStore & {
    load(): Promise<PersistedState | null>;
    save(state: PersistedState): Promise<void>;
  };
  mcp: {
    /** MCP servers configured for Claude Desktop, Claude Code, plugins, this repo and Cursor. Read-only. */
    list(): Promise<McpSource[]>;
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
  listCloudFlows: "cloudFlows:list",
  getCloudFlow: "cloudFlows:get",
  saveCloudFlow: "cloudFlows:save",
  deleteCloudFlow: "cloudFlows:delete",
  generateJson: "optimization:generate-json",
  listMcp: "mcp:list",
  listTools: "tools:list",
  refreshTools: "tools:refresh",
  runTool: "tools:run",
  cancelTool: "tools:cancel",
  installTool: "tools:install",
  fixToolSetup: "tools:fixSetup",
  /** main -> renderer: `{ runId, stream, chunk }` for runs started with a runId. */
  toolOutput: "tools:output",
  runAgent: "runtime:run",
} as const;
