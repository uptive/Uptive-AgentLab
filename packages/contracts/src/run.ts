import type { Usage } from "./usage.js";
import type { ToolCall } from "./agent.js";
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
   * Snapshot of the flow that was executed. Lets viewers draw the graph for flows
   * that aren't in a shared registry (project files, ad-hoc single-agent runs).
   */
  flow?: FlowDefinition;
  /** The input the run was started with, so it can be rerun as-is. */
  input?: unknown;
}

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
