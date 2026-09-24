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

export interface AgentDefinition {
  id: string;
  name: string;
  description?: string;
  role: string;
  systemInstructions: string;
  model: ModelId;
  modelSettings?: ModelSettings;
  tools: ToolRef[];
  inputSchema?: unknown;
  outputSchema?: unknown;
  limits?: UsageLimits;
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
