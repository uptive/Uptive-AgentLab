import type { Usage } from "./usage.js";

export type ModelId = string;

export interface ModelSettings {
  temperature?: number;
  maxTokens?: number;
  [key: string]: unknown;
}

export interface ToolRef {
  id: string;
  name: string;
  kind: "mcp" | "function";
}

export interface UsageLimits {
  maxTokens?: number;
  maxCostUsd?: number;
}

export type AgentStatus = "active" | "draft" | "disabled";

/** Roles seeded into an empty role list. Roles are labels shown on flow nodes; behaviour lives in systemInstructions. */
export const DEFAULT_AGENT_ROLES = ["planner", "researcher", "reviewer", "writer", "validator", "orchestrator"];

export interface AgentDefinition {
  id: string;
  name: string;
  description?: string;
  /** Short category label, reused across agents via AgentRoleStore (e.g. "reviewer"). */
  role: string;
  /** Lifecycle state shown in the UI; treated as "draft" when unset. */
  status?: AgentStatus;
  systemInstructions: string;
  model: ModelId;
  modelSettings?: ModelSettings;
  tools: ToolRef[];
  inputSchema?: unknown;
  outputSchema?: unknown;
  limits?: UsageLimits;
  createdAt?: string;
  updatedAt?: string;
}

/** Fields a caller supplies when creating an agent; id and timestamps are assigned by the store. */
export type AgentInput = Omit<AgentDefinition, "id" | "createdAt" | "updatedAt">;

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
