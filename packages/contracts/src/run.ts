import type { Usage } from "./usage.js";
import type { AgentDefinition, ToolCall } from "./agent.js";
import type { FlowDefinition } from "./flow.js";

export type StepStatus = "pending" | "running" | "completed" | "failed";

export interface StepRun {
  id: string;
  runId: string;
  nodeId: string;
  agentId: string;
  status: StepStatus;
  input: unknown;
  output?: unknown;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  usage?: Usage;
  toolCalls: ToolCall[];
}

export type RunStatus = "pending" | "running" | "completed" | "failed";

export interface Run {
  id: string;
  flowId: string;
  status: RunStatus;
  startedAt: string;
  completedAt?: string;
  steps: StepRun[];
  totalUsage?: Usage;
  /**
   * Snapshots of the flow and agents as they were when the run executed, so a run stays
   * understandable (and analyzable, and rerunnable) after the flow or its agents are edited,
   * and so graphs can be drawn for flows that aren't in a shared registry.
   */
  flow?: FlowDefinition;
  agents?: AgentDefinition[];
  /** The input the run was started with, so it can be rerun as-is. */
  input?: unknown;
  /** What paid for the model calls: a claude.ai subscription login, or an API key. */
  authSource?: AuthSource;
  /** Where the run was started from: the app itself, or Claude Code through the local bridge. */
  startedBy?: RunTrigger;
}

export type AuthSource = "subscription" | "api-key" | "unknown";

export type RunTrigger = "app" | "claude-code";

/**
 * Live output of a running step, streamed token by token. Not persisted: the finished content ends
 * up in the step's model_call and tool_call trace events.
 */
export type AgentStreamChunk = { runId: string; stepRunId: string } & (
  | { type: "block"; block: "thinking" | "text" | "tool_use"; toolName?: string; toolUseId?: string }
  | { type: "delta"; text: string }
  | { type: "usage"; inputTokens: number; outputTokens: number }
);

export type TraceEventType =
  | "agent_start"
  | "agent_end"
  | "model_call"
  | "tool_call"
  | "flow_start"
  | "flow_end"
  | "node_start"
  | "node_end";

export interface TraceEvent {
  id: string;
  runId: string;
  stepRunId?: string;
  type: TraceEventType;
  timestamp: string;
  data: unknown;
}
