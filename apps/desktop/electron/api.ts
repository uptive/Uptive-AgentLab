/** Shared contract for the preload bridge (`window.agentlab`). Types only + channel names. */

import type {
  AgentDefinition,
  AgentInput,
  AgentRuntime,
  AgentStreamChunk,
  FlowDefinition,
  FlowStore,
  McpServerDefinition,
  McpServerInput,
  Run,
  SkillDefinition,
  TraceEvent,
  Usage,
} from "@agentlab/contracts";
import type { ClaudeAuthStatus, McpTestResult } from "@agentlab/agent-runtime/claude";
import type { AsyncTelemetryStore, PersistedState } from "@agentlab/observability";
import type { JsonRequest } from "@agentlab/optimization";
import type { NotificationSettings } from "./notificationSettings.js";
import type { OptimizationSummary, RunOutcome } from "./notificationState.js";

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

export interface StartRunRequest {
  flow: FlowDefinition;
  input: unknown;
  /** A folder agents may read (e.g. the repository a review flow looks at). */
  folder?: string;
}

/** An unsaved agent run once from the editor. Not saved to Runs. */
export interface AgentTestRequest {
  /** Chosen by the caller so it can match stream chunks (runId and stepRunId both equal it). */
  testId: string;
  agent: AgentDefinition;
  input: unknown;
}

/** "no-schema" = nothing to check against, "bad-schema" = the schema itself does not compile. */
export interface SchemaCheck {
  status: "valid" | "invalid" | "no-schema" | "bad-schema" | "skipped";
  errors: string[];
}

export interface AgentTestResult {
  status: "completed" | "failed" | "cancelled";
  output: unknown;
  error?: string;
  usage: Usage;
  toolCallCount: number;
  inputCheck: SchemaCheck;
  /** "skipped" when the run did not complete. */
  outputCheck: SchemaCheck;
}

export interface AgentJudgeRequest {
  agent: AgentDefinition;
  input: unknown;
  output: unknown;
}

/** Claude's grade of one test output against the agent's instructions. */
export interface AgentJudgement {
  /** 1 (unusable) to 5 (fully meets the instructions). */
  score: number;
  verdict: string;
  strengths: string[];
  issues: string[];
}

/** A server in the app's MCP library (see McpServerEntry for servers listed from other apps' configs). */
export interface LibraryMcpServer extends McpServerDefinition {
  /** Whether the secret this server references is stored on this computer. */
  hasSecret: boolean;
}

export interface ImportResult {
  imported: string[];
  skipped: { name: string; reason: string }[];
}

export type { ClaudeAuthStatus, McpTestResult };

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
  /** Tool names the draft may pick from (built-in and function tools). */
  tools: string[];
}

/** Agent fields proposed by Claude from a free-text description; reviewed in the form before applying. */
export interface AgentDraft {
  name: string;
  description: string;
  role: string;
  systemInstructions: string;
  model: string;
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  /** Names from AgentDraftRequest.tools. */
  tools: string[];
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

export type { NotificationSettings, OptimizationSummary, RunOutcome };

export interface NotificationStatus {
  settings: NotificationSettings;
  /** False on systems where the OS offers no notifications. */
  supported: boolean;
  webhookConfigured: boolean;
  /** Why the last webhook post failed; cleared by the next one that succeeds. */
  webhookError?: string;
  /** Set when the settings file exists but could not be read. */
  settingsError?: string;
  /** Why the custom sound last failed to play (the system beep was used instead). */
  soundError?: string;
}

export type WebhookTestResult = { status: "sent" } | { status: "not-configured" } | { status: "failed"; error: string };

export interface NotificationTestResult {
  /** False when the OS does not support notifications. */
  notificationShown: boolean;
  webhook: WebhookTestResult;
}

/** Where a notification or tray click sends the user. */
export type OpenTarget = { view: "runs"; runId?: string } | { view: "optimize" };

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
    /** Runs an agent definition (saved or not) once with the real runtime. Not saved to Runs. */
    test(request: AgentTestRequest): Promise<AgentTestResult>;
    cancelTest(testId: string): Promise<void>;
    /** Live token output of running tests, in batches. */
    onTestStream(listener: (chunks: AgentStreamChunk[]) => void): () => void;
    /** Asks Claude to score a test output. One extra model call. */
    judge(request: AgentJudgeRequest): Promise<AgentJudgement>;
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
  /** Real flow runs, executed by the Claude runtime in the main process. */
  runs: {
    /** Resolves as soon as the run has started. Progress arrives through onUpdate/onEvent. */
    start(request: StartRunRequest): Promise<{ runId: string }>;
    cancel(runId: string): Promise<void>;
    /** Subscribes to run snapshots; returns an unsubscribe function. */
    onUpdate(listener: (run: Run) => void): () => void;
    onEvent(listener: (event: TraceEvent) => void): () => void;
    /** Live token output of running steps, in batches. Not persisted. */
    onStream(listener: (chunks: AgentStreamChunk[]) => void): () => void;
    /** Opens a folder picker; undefined when cancelled. */
    pickFolder(): Promise<string | undefined>;
  };
  claude: {
    authStatus(refresh?: boolean): Promise<ClaudeAuthStatus>;
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
    list(): Promise<LibraryMcpServer[]>;
    /** `secret`: a new value to store, null to remove the stored one, undefined to keep it. */
    save(input: McpServerInput, secret?: string | null): Promise<LibraryMcpServer>;
    delete(id: string): Promise<boolean>;
    test(id: string): Promise<McpTestResult>;
    importClaudeDesktop(): Promise<ImportResult>;
  };
  mcp: {
    /** MCP servers configured for Claude Desktop, Claude Code, plugins, this repo and Cursor. Read-only. */
    list(): Promise<McpSource[]>;
  };
  /** Run notifications, the tray icon and the Slack webhook. Everything is decided in the main process. */
  notifications: {
    status(): Promise<NotificationStatus>;
    save(settings: NotificationSettings): Promise<NotificationStatus>;
    /** null removes the stored URL. */
    setWebhookUrl(url: string | null): Promise<NotificationStatus>;
    /** Shows a sample notification and posts a sample message to the webhook, if one is set. */
    sendTest(): Promise<NotificationTestResult>;
    /** Opens a file dialog for the notification sound. Cancelling leaves it unchanged. */
    pickSoundFile(): Promise<NotificationStatus>;
    /** Goes back to the system sound. */
    clearSoundFile(): Promise<NotificationStatus>;
    /** Plays the chosen sound file once; rejects when it cannot be played. */
    previewSound(): Promise<void>;
    onStatus(listener: (status: NotificationStatus) => void): () => void;
    /** Reports a finished Optimize analysis; main notifies only if the window is unfocused. */
    optimizationFinished(summary: OptimizationSummary): Promise<void>;
    /** Main asks the window to open something (a notification or tray item was clicked); call takeOpenTarget. */
    onOpen(listener: () => void): () => void;
    /** What the user asked to open, once; undefined when there is nothing. */
    takeOpenTarget(): Promise<OpenTarget | undefined>;
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
  startRun: "runs:start",
  cancelRun: "runs:cancel",
  runUpdate: "runs:update",
  runEvent: "runs:event",
  runStream: "runs:stream",
  pickFolder: "runs:pick-folder",
  authStatus: "claude:auth-status",
  listSkills: "skills:list",
  saveSkill: "skills:save",
  deleteSkill: "skills:delete",
  revealSkill: "skills:reveal",
  importSkills: "skills:import",
  listMcpServers: "mcpServers:list",
  saveMcpServer: "mcpServers:save",
  deleteMcpServer: "mcpServers:delete",
  testMcpServer: "mcpServers:test",
  importClaudeDesktop: "mcpServers:import-claude-desktop",
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
  testAgent: "agents:test",
  cancelAgentTest: "agents:test-cancel",
  agentTestStream: "agents:test-stream",
  judgeAgent: "agents:judge",
  getNotificationStatus: "notifications:getStatus",
  saveNotificationSettings: "notifications:saveSettings",
  setNotificationWebhook: "notifications:setWebhookUrl",
  sendTestNotification: "notifications:sendTest",
  pickNotificationSound: "notifications:pickSoundFile",
  clearNotificationSound: "notifications:clearSoundFile",
  previewNotificationSound: "notifications:previewSound",
  notifyOptimization: "notifications:optimizationFinished",
  takeOpenTarget: "notifications:takeOpenTarget",
  /** main -> renderer: NotificationStatus after any change. */
  notificationStatus: "notifications:status",
  /** main -> renderer: no payload; the renderer calls takeOpenTarget. */
  openTarget: "notifications:open",
} as const;
