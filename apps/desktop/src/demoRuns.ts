import type { Run, TraceEvent } from "@agentlab/contracts";
import { demoFlow } from "@agentlab/flow-engine";

// Mock run for the "Review PR #42" scenario, so Group 3 can build against real
// data before Group 1's runtime and Group 2's flow engine are wired up.

const t = (offsetMs: number) => new Date(Date.UTC(2026, 8, 24, 13, 32, 0) + offsetMs).toISOString();

export const demoRun: Run = {
  id: "run-demo-1",
  flowId: demoFlow.id,
  status: "completed",
  startedAt: t(0),
  completedAt: t(6500),
  totalUsage: {
    inputTokens: 4820,
    outputTokens: 1310,
    estimatedCostUsd: 0.1834,
    latencyMs: 6500,
  },
  steps: [
    {
      id: "step-n1",
      runId: "run-demo-1",
      nodeId: "n1",
      agentId: "planner",
      status: "completed",
      input: { task: "Review PR #42. Focus on bugs, security risks and regression risk." },
      output: {
        plan: ["Check diff for logic bugs", "Check diff for security issues", "Summarize into a final verdict"],
      },
      startedAt: t(0),
      completedAt: t(1800),
      usage: { inputTokens: 420, outputTokens: 180, estimatedCostUsd: 0.0091, latencyMs: 1800 },
      toolCalls: [],
    },
    {
      id: "step-n2",
      runId: "run-demo-1",
      nodeId: "n2",
      agentId: "code-reviewer",
      status: "completed",
      input: { plan: "Check diff for logic bugs", files: ["src/payment/charge.ts"] },
      output: {
        findings: ["Off-by-one error in retry loop", "Missing null check on charge response"],
      },
      startedAt: t(1800),
      completedAt: t(4900),
      usage: { inputTokens: 2100, outputTokens: 540, estimatedCostUsd: 0.0786, latencyMs: 3100 },
      toolCalls: [
        {
          toolId: "read_file",
          input: { path: "src/payment/charge.ts" },
          output: { lines: 182 },
          startedAt: t(1900),
          completedAt: t(2150),
        },
      ],
    },
    {
      id: "step-n3",
      runId: "run-demo-1",
      nodeId: "n3",
      agentId: "security-reviewer",
      status: "completed",
      input: { plan: "Check diff for security issues", files: ["src/payment/charge.ts"] },
      output: {
        findings: ["User-supplied amount not re-validated server-side before charge"],
      },
      startedAt: t(1800),
      completedAt: t(5200),
      usage: { inputTokens: 1950, outputTokens: 430, estimatedCostUsd: 0.0682, latencyMs: 3400 },
      toolCalls: [
        {
          toolId: "grep_search",
          input: { query: "amount", includePattern: "src/payment/**" },
          output: { matches: 6 },
          startedAt: t(2000),
          completedAt: t(2260),
        },
      ],
    },
    {
      id: "step-n4",
      runId: "run-demo-1",
      nodeId: "n4",
      agentId: "final-validator",
      status: "completed",
      input: {
        codeReview: ["Off-by-one error in retry loop", "Missing null check on charge response"],
        securityReview: ["User-supplied amount not re-validated server-side before charge"],
      },
      output: {
        verdict: "changes_requested",
        summary: "Blocking: server-side amount validation. Non-blocking: retry loop and null check.",
      },
      startedAt: t(5200),
      completedAt: t(6500),
      usage: { inputTokens: 350, outputTokens: 160, estimatedCostUsd: 0.0275, latencyMs: 1300 },
      toolCalls: [],
    },
  ],
};

export const demoTraceEvents: TraceEvent[] = [
  { id: "e1", runId: demoRun.id, type: "flow_start", timestamp: t(0), data: { flowId: demoFlow.id } },
  { id: "e2", runId: demoRun.id, stepRunId: "step-n1", type: "node_start", timestamp: t(0), data: { nodeId: "n1" } },
  { id: "e3", runId: demoRun.id, stepRunId: "step-n1", type: "agent_start", timestamp: t(0), data: { agentId: "planner" } },
  { id: "e4", runId: demoRun.id, stepRunId: "step-n1", type: "model_call", timestamp: t(600), data: { model: "gpt-4o-mini" } },
  { id: "e5", runId: demoRun.id, stepRunId: "step-n1", type: "agent_end", timestamp: t(1800), data: { agentId: "planner" } },
  { id: "e6", runId: demoRun.id, stepRunId: "step-n1", type: "node_end", timestamp: t(1800), data: { nodeId: "n1" } },
  { id: "e7", runId: demoRun.id, stepRunId: "step-n2", type: "node_start", timestamp: t(1800), data: { nodeId: "n2" } },
  { id: "e8", runId: demoRun.id, stepRunId: "step-n3", type: "node_start", timestamp: t(1800), data: { nodeId: "n3" } },
  { id: "e9", runId: demoRun.id, stepRunId: "step-n2", type: "model_call", timestamp: t(1850), data: { model: "gpt-4o" } },
  { id: "e10", runId: demoRun.id, stepRunId: "step-n3", type: "model_call", timestamp: t(1870), data: { model: "gpt-4o" } },
  { id: "e11", runId: demoRun.id, stepRunId: "step-n2", type: "tool_call", timestamp: t(1900), data: { toolId: "read_file" } },
  { id: "e12", runId: demoRun.id, stepRunId: "step-n3", type: "tool_call", timestamp: t(2000), data: { toolId: "grep_search" } },
  { id: "e13", runId: demoRun.id, stepRunId: "step-n2", type: "agent_end", timestamp: t(4900), data: { agentId: "code-reviewer" } },
  { id: "e14", runId: demoRun.id, stepRunId: "step-n3", type: "agent_end", timestamp: t(5200), data: { agentId: "security-reviewer" } },
  { id: "e15", runId: demoRun.id, stepRunId: "step-n2", type: "node_end", timestamp: t(4900), data: { nodeId: "n2" } },
  { id: "e16", runId: demoRun.id, stepRunId: "step-n3", type: "node_end", timestamp: t(5200), data: { nodeId: "n3" } },
  { id: "e17", runId: demoRun.id, stepRunId: "step-n4", type: "node_start", timestamp: t(5200), data: { nodeId: "n4" } },
  { id: "e18", runId: demoRun.id, stepRunId: "step-n4", type: "model_call", timestamp: t(5300), data: { model: "gpt-4o-mini" } },
  { id: "e19", runId: demoRun.id, stepRunId: "step-n4", type: "agent_end", timestamp: t(6500), data: { agentId: "final-validator" } },
  { id: "e20", runId: demoRun.id, stepRunId: "step-n4", type: "node_end", timestamp: t(6500), data: { nodeId: "n4" } },
  { id: "e21", runId: demoRun.id, type: "flow_end", timestamp: t(6500), data: { status: "completed" } },
];
