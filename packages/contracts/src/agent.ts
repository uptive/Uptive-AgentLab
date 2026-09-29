import type { Usage } from "./usage.js";

export type ModelId = string;

export interface ModelSettings {
  temperature?: number;
  maxTokens?: number;
  [key: string]: unknown;
}

/**
 * A tool an agent may use.
 * - "builtin": a Claude Code tool such as Read, Grep, Glob, WebSearch, WebFetch or Bash (`name` is the tool name).
 * - "mcp": a tool on a registered MCP server (`serverId`); omit `toolName` to allow every tool on that server.
 * - "function": an in-process tool implemented by the app (`id` is the function tool id).
 */
export interface ToolRef {
  id: string;
  name: string;
  kind: "builtin" | "mcp" | "function";
  /** For kind "mcp": id of the `McpServerDefinition` that provides the tool. */
  serverId?: string;
  /** For kind "mcp": the tool's name on that server; omitted means all of the server's tools. */
  toolName?: string;
}

export interface UsageLimits {
  maxTokens?: number;
  maxCostUsd?: number;
}

export type AgentStatus = "active" | "draft" | "disabled";
export type AgentEngine = "claude" | "jev";

/** Roles seeded into an empty role list. Roles are labels shown on flow nodes; behaviour lives in systemInstructions. */
export const DEFAULT_AGENT_ROLES = ["planner", "researcher", "reviewer", "writer", "validator", "orchestrator"];

interface AgentDefinitionBase {
  id: string;
  name: string;
  description?: string;
  /** Short category label, reused across agents via AgentRoleStore (e.g. "reviewer"). */
  role: string;
  /** Lifecycle state shown in the UI; treated as "draft" when unset. */
  status?: AgentStatus;
  model: ModelId;
  inputSchema?: unknown;
  outputSchema?: unknown;
  limits?: UsageLimits;
  createdAt?: string;
  updatedAt?: string;
}

export interface ClaudeAgentDefinition extends AgentDefinitionBase {
  /** Missing on legacy records, which are treated as Claude agents. */
  engine?: "claude";
  systemInstructions: string;
  modelSettings?: ModelSettings;
  tools: ToolRef[];
  /** Names of skills (see `SkillDefinition`) the agent may load. */
  skills?: string[];
}

export interface JevNoulQuestion {
  id: string;
  type: "noul";
  instructions: string;
  criteria?: { true?: string; false?: string };
}

export interface JevChoiceQuestion {
  id: string;
  type: "choice";
  instructions: string;
  criteria: Record<string, string | null>;
}

export interface JevScoreQuestion {
  id: string;
  type: "score";
  instructions: string;
  criteria: [string, string, ...string[]];
}

export type JevQuestion = JevNoulQuestion | JevChoiceQuestion | JevScoreQuestion;

export interface JevAgentDefinition extends AgentDefinitionBase {
  engine: "jev";
  questions: JevQuestion[];
  systemInstructions?: never;
  modelSettings?: never;
  tools?: never;
  skills?: never;
}

export type AgentDefinition = ClaudeAgentDefinition | JevAgentDefinition;

/** Fields a caller supplies when creating an agent; id and timestamps are assigned by the store. */
export type AgentInput = AgentDefinition extends infer T
  ? T extends AgentDefinition
    ? Omit<T, "id" | "createdAt" | "updatedAt">
    : never
  : never;

export function agentEngine(agent: Pick<AgentDefinition, "engine">): AgentEngine {
  return agent.engine ?? "claude";
}

/** Persistence for agent definitions. Shared seam: other groups look agents up through this. */
export interface AgentStore {
  list(): Promise<AgentDefinition[]>;
  get(id: string): Promise<AgentDefinition | undefined>;
  create(input: AgentInput): Promise<AgentDefinition>;
  /** Partial update; throws if the agent does not exist. */
  update(id: string, patch: Partial<AgentInput>): Promise<AgentDefinition>;
  /** Returns false if the agent did not exist. */
  delete(id: string): Promise<boolean>;
}

/** An MCP server that agents can use tools from. Secrets are never stored here, only referenced. */
export interface McpServerDefinition {
  id: string;
  name: string;
  description?: string;
  transport:
    | { type: "http"; url: string }
    | { type: "stdio"; command: string; args?: string[] };
  /**
   * Name of a secret held by the app (not in this file). For "http" it is sent as a bearer token,
   * for "stdio" it is passed as the environment variable `secretEnvVar`.
   */
  secretRef?: string;
  secretEnvVar?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type McpServerInput = Omit<McpServerDefinition, "createdAt" | "updatedAt">;

export interface McpServerStore {
  list(): Promise<McpServerDefinition[]>;
  get(id: string): Promise<McpServerDefinition | undefined>;
  /** Creates or replaces the server with this id. */
  save(input: McpServerInput): Promise<McpServerDefinition>;
  delete(id: string): Promise<boolean>;
}

/** A skill: instructions Claude loads on demand when `description` matches the task. Stored as `<name>/SKILL.md`. */
export interface SkillDefinition {
  /** Lowercase letters, digits and hyphens; also the folder name. */
  name: string;
  /** When Claude should use the skill. This is what Claude sees when deciding to load it. */
  description: string;
  /** The skill body (markdown). */
  instructions: string;
  updatedAt?: string;
}

export interface SkillStore {
  list(): Promise<SkillDefinition[]>;
  get(name: string): Promise<SkillDefinition | undefined>;
  /** Creates or replaces the skill with this name. */
  save(skill: SkillDefinition): Promise<SkillDefinition>;
  delete(name: string): Promise<boolean>;
}

/** Reusable role labels offered as suggestions when editing agents. */
export interface AgentRoleStore {
  /** Role names sorted alphabetically. */
  list(): Promise<string[]>;
  /** Adds a role if no role with the same name (ignoring case) exists. */
  add(name: string): Promise<void>;
}

export interface AgentRunContext {
  runId: string;
  stepRunId: string;
  priorOutputs?: Record<string, unknown>;
}

export interface AgentResult {
  agentId: string;
  status: "completed" | "failed";
  output: unknown;
  error?: string;
  usage: Usage;
  toolCalls: ToolCall[];
}

export interface ToolCall {
  toolId: string;
  input: unknown;
  output: unknown;
  startedAt: string;
  completedAt: string;
}

export interface AgentRuntime {
  run(agent: AgentDefinition, input: unknown, context: AgentRunContext): Promise<AgentResult>;
}
