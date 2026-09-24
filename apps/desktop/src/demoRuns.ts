import type { Run, TraceEvent } from "@agentlab/contracts";
import { demoFlow } from "@agentlab/flow-engine";

// Mock runs for the "Review PR" scenario. These are seeded once (idempotently
// per run id) so Group 3's Runs view has variety to demo the drill-down against
// before Group 1's runtime and Group 2's flow engine emit real events.

// Times are anchored to module load so the "3s ago / 45m ago" labels feel live.
const NOW = Date.now();
const iso = (msFromNow: number) => new Date(NOW + msFromNow).toISOString();

// --- Run 1: PR #42, completed, the original workshop scenario -------------------
const run1Start = -3 * 60 * 1000; // 3 minutes ago
const run1: Run = {
  id: "run-demo-1",
  flowId: demoFlow.id,
  status: "completed",
  startedAt: iso(run1Start),
  completedAt: iso(run1Start + 6500),
  totalUsage: { inputTokens: 4820, outputTokens: 1310, estimatedCostUsd: 0.1834, latencyMs: 6500 },
  steps: [
    {
      id: "step-1-n1",
      runId: "run-demo-1",
      nodeId: "n1",
      agentId: "planner",
      status: "completed",
      input: { task: "Review PR #42. Focus on bugs, security risks and regression risk." },
      output: { plan: ["Check diff for logic bugs", "Check diff for security issues", "Summarize into a final verdict"] },
      startedAt: iso(run1Start),
      completedAt: iso(run1Start + 1800),
      usage: { inputTokens: 420, outputTokens: 180, estimatedCostUsd: 0.0091, latencyMs: 1800 },
      toolCalls: [],
    },
    {
      id: "step-1-n2",
      runId: "run-demo-1",
      nodeId: "n2",
      agentId: "code-reviewer",
      status: "completed",
      input: { plan: "Check diff for logic bugs", files: ["src/payment/charge.ts"] },
      output: { findings: ["Off-by-one error in retry loop", "Missing null check on charge response"] },
      startedAt: iso(run1Start + 1800),
      completedAt: iso(run1Start + 4900),
      usage: { inputTokens: 2100, outputTokens: 540, estimatedCostUsd: 0.0786, latencyMs: 3100 },
      toolCalls: [
        {
          toolId: "read_file",
          input: { path: "src/payment/charge.ts" },
          output: { lines: 182 },
          startedAt: iso(run1Start + 1900),
          completedAt: iso(run1Start + 2150),
        },
      ],
    },
    {
      id: "step-1-n3",
      runId: "run-demo-1",
      nodeId: "n3",
      agentId: "security-reviewer",
      status: "completed",
      input: { plan: "Check diff for security issues", files: ["src/payment/charge.ts"] },
      output: { findings: ["User-supplied amount not re-validated server-side before charge"] },
      startedAt: iso(run1Start + 1800),
      completedAt: iso(run1Start + 5200),
      usage: { inputTokens: 1950, outputTokens: 430, estimatedCostUsd: 0.0682, latencyMs: 3400 },
      toolCalls: [
        {
          toolId: "grep_search",
          input: { query: "amount", includePattern: "src/payment/**" },
          output: { matches: 6 },
          startedAt: iso(run1Start + 2000),
          completedAt: iso(run1Start + 2260),
        },
      ],
    },
    {
      id: "step-1-n4",
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
      startedAt: iso(run1Start + 5200),
      completedAt: iso(run1Start + 6500),
      usage: { inputTokens: 350, outputTokens: 160, estimatedCostUsd: 0.0275, latencyMs: 1300 },
      toolCalls: [],
    },
  ],
};

const run1Events: TraceEvent[] = [
  { id: "e1-1", runId: run1.id, type: "flow_start", timestamp: iso(run1Start), data: { flowId: demoFlow.id } },
  { id: "e1-2", runId: run1.id, stepRunId: "step-1-n1", type: "node_start", timestamp: iso(run1Start), data: { nodeId: "n1" } },
  { id: "e1-3", runId: run1.id, stepRunId: "step-1-n1", type: "agent_start", timestamp: iso(run1Start), data: { agentId: "planner" } },
  { id: "e1-4", runId: run1.id, stepRunId: "step-1-n1", type: "model_call", timestamp: iso(run1Start + 600), data: { model: "gpt-4o-mini" } },
  { id: "e1-5", runId: run1.id, stepRunId: "step-1-n1", type: "agent_end", timestamp: iso(run1Start + 1800), data: { agentId: "planner" } },
  { id: "e1-6", runId: run1.id, stepRunId: "step-1-n1", type: "node_end", timestamp: iso(run1Start + 1800), data: { nodeId: "n1" } },
  { id: "e1-7", runId: run1.id, stepRunId: "step-1-n2", type: "node_start", timestamp: iso(run1Start + 1800), data: { nodeId: "n2" } },
  { id: "e1-8", runId: run1.id, stepRunId: "step-1-n3", type: "node_start", timestamp: iso(run1Start + 1800), data: { nodeId: "n3" } },
  { id: "e1-9", runId: run1.id, stepRunId: "step-1-n2", type: "model_call", timestamp: iso(run1Start + 1850), data: { model: "gpt-4o" } },
  { id: "e1-10", runId: run1.id, stepRunId: "step-1-n3", type: "model_call", timestamp: iso(run1Start + 1870), data: { model: "gpt-4o" } },
  { id: "e1-11", runId: run1.id, stepRunId: "step-1-n2", type: "tool_call", timestamp: iso(run1Start + 1900), data: { toolId: "read_file" } },
  { id: "e1-12", runId: run1.id, stepRunId: "step-1-n3", type: "tool_call", timestamp: iso(run1Start + 2000), data: { toolId: "grep_search" } },
  { id: "e1-13", runId: run1.id, stepRunId: "step-1-n2", type: "agent_end", timestamp: iso(run1Start + 4900), data: { agentId: "code-reviewer" } },
  { id: "e1-14", runId: run1.id, stepRunId: "step-1-n3", type: "agent_end", timestamp: iso(run1Start + 5200), data: { agentId: "security-reviewer" } },
  { id: "e1-15", runId: run1.id, stepRunId: "step-1-n2", type: "node_end", timestamp: iso(run1Start + 4900), data: { nodeId: "n2" } },
  { id: "e1-16", runId: run1.id, stepRunId: "step-1-n3", type: "node_end", timestamp: iso(run1Start + 5200), data: { nodeId: "n3" } },
  { id: "e1-17", runId: run1.id, stepRunId: "step-1-n4", type: "node_start", timestamp: iso(run1Start + 5200), data: { nodeId: "n4" } },
  { id: "e1-18", runId: run1.id, stepRunId: "step-1-n4", type: "model_call", timestamp: iso(run1Start + 5300), data: { model: "gpt-4o-mini" } },
  { id: "e1-19", runId: run1.id, stepRunId: "step-1-n4", type: "agent_end", timestamp: iso(run1Start + 6500), data: { agentId: "final-validator" } },
  { id: "e1-20", runId: run1.id, stepRunId: "step-1-n4", type: "node_end", timestamp: iso(run1Start + 6500), data: { nodeId: "n4" } },
  { id: "e1-21", runId: run1.id, type: "flow_end", timestamp: iso(run1Start + 6500), data: { status: "completed" } },
];

// --- Run 2: PR #43, tiny doc typo, completed fast and cheap ---------------------
const run2Start = -45 * 60 * 1000; // 45 min ago
const run2: Run = {
  id: "run-demo-2",
  flowId: demoFlow.id,
  status: "completed",
  startedAt: iso(run2Start),
  completedAt: iso(run2Start + 3200),
  totalUsage: { inputTokens: 1240, outputTokens: 320, estimatedCostUsd: 0.0421, latencyMs: 3200 },
  steps: [
    {
      id: "step-2-n1", runId: "run-demo-2", nodeId: "n1", agentId: "planner", status: "completed",
      input: { task: "Review PR #43. Small doc typo fix in README." },
      output: { plan: ["Verify only docs changed", "No security scan needed", "Rubber-stamp"] },
      startedAt: iso(run2Start), completedAt: iso(run2Start + 900),
      usage: { inputTokens: 180, outputTokens: 60, estimatedCostUsd: 0.0038, latencyMs: 900 },
      toolCalls: [],
    },
    {
      id: "step-2-n2", runId: "run-demo-2", nodeId: "n2", agentId: "code-reviewer", status: "completed",
      input: { plan: "Verify only docs changed" },
      output: { findings: [] },
      startedAt: iso(run2Start + 900), completedAt: iso(run2Start + 2100),
      usage: { inputTokens: 520, outputTokens: 90, estimatedCostUsd: 0.0164, latencyMs: 1200 },
      toolCalls: [],
    },
    {
      id: "step-2-n3", runId: "run-demo-2", nodeId: "n3", agentId: "security-reviewer", status: "completed",
      input: { plan: "No security scan needed" },
      output: { findings: [] },
      startedAt: iso(run2Start + 900), completedAt: iso(run2Start + 1900),
      usage: { inputTokens: 380, outputTokens: 70, estimatedCostUsd: 0.0129, latencyMs: 1000 },
      toolCalls: [],
    },
    {
      id: "step-2-n4", runId: "run-demo-2", nodeId: "n4", agentId: "final-validator", status: "completed",
      input: { codeReview: [], securityReview: [] },
      output: { verdict: "approved", summary: "LGTM. Docs-only change." },
      startedAt: iso(run2Start + 2100), completedAt: iso(run2Start + 3200),
      usage: { inputTokens: 160, outputTokens: 100, estimatedCostUsd: 0.0090, latencyMs: 1100 },
      toolCalls: [],
    },
  ],
};

const run2Events: TraceEvent[] = [
  { id: "e2-1", runId: run2.id, type: "flow_start", timestamp: iso(run2Start), data: { flowId: demoFlow.id } },
  { id: "e2-2", runId: run2.id, stepRunId: "step-2-n1", type: "model_call", timestamp: iso(run2Start + 200), data: { model: "gpt-4o-mini" } },
  { id: "e2-3", runId: run2.id, stepRunId: "step-2-n2", type: "model_call", timestamp: iso(run2Start + 1000), data: { model: "gpt-4o" } },
  { id: "e2-4", runId: run2.id, stepRunId: "step-2-n3", type: "model_call", timestamp: iso(run2Start + 1000), data: { model: "gpt-4o" } },
  { id: "e2-5", runId: run2.id, stepRunId: "step-2-n4", type: "model_call", timestamp: iso(run2Start + 2200), data: { model: "gpt-4o-mini" } },
  { id: "e2-6", runId: run2.id, type: "flow_end", timestamp: iso(run2Start + 3200), data: { status: "completed" } },
];

// --- Run 3: PR #41, failed at security review (rate limit) ----------------------
const run3Start = -2 * 60 * 60 * 1000; // 2h ago
const run3: Run = {
  id: "run-demo-3",
  flowId: demoFlow.id,
  status: "failed",
  startedAt: iso(run3Start),
  completedAt: iso(run3Start + 4100),
  totalUsage: { inputTokens: 2410, outputTokens: 420, estimatedCostUsd: 0.0812, latencyMs: 4100 },
  steps: [
    {
      id: "step-3-n1", runId: "run-demo-3", nodeId: "n1", agentId: "planner", status: "completed",
      input: { task: "Review PR #41. Auth flow refactor." },
      output: { plan: ["Audit new session handling", "Check token refresh path", "Verify no logging of secrets"] },
      startedAt: iso(run3Start), completedAt: iso(run3Start + 1600),
      usage: { inputTokens: 390, outputTokens: 170, estimatedCostUsd: 0.0084, latencyMs: 1600 },
      toolCalls: [],
    },
    {
      id: "step-3-n2", runId: "run-demo-3", nodeId: "n2", agentId: "code-reviewer", status: "completed",
      input: { plan: "Audit new session handling" },
      output: { findings: ["Session TTL not configurable", "Refresh token stored in localStorage"] },
      startedAt: iso(run3Start + 1600), completedAt: iso(run3Start + 3800),
      usage: { inputTokens: 1420, outputTokens: 210, estimatedCostUsd: 0.0492, latencyMs: 2200 },
      toolCalls: [
        {
          toolId: "read_file",
          input: { path: "src/auth/session.ts" },
          output: { lines: 340 },
          startedAt: iso(run3Start + 1700), completedAt: iso(run3Start + 2050),
        },
      ],
    },
    {
      id: "step-3-n3", runId: "run-demo-3", nodeId: "n3", agentId: "security-reviewer", status: "failed",
      input: { plan: "Check token refresh path" },
      error: "OpenAI rate limit exceeded (429). Retried 3 times then gave up.",
      startedAt: iso(run3Start + 1600), completedAt: iso(run3Start + 4100),
      usage: { inputTokens: 600, outputTokens: 40, estimatedCostUsd: 0.0236, latencyMs: 2500 },
      toolCalls: [],
    },
    {
      id: "step-3-n4", runId: "run-demo-3", nodeId: "n4", agentId: "final-validator", status: "pending",
      input: {}, toolCalls: [],
    },
  ],
};

const run3Events: TraceEvent[] = [
  { id: "e3-1", runId: run3.id, type: "flow_start", timestamp: iso(run3Start), data: { flowId: demoFlow.id } },
  { id: "e3-2", runId: run3.id, stepRunId: "step-3-n1", type: "model_call", timestamp: iso(run3Start + 300), data: { model: "gpt-4o-mini" } },
  { id: "e3-3", runId: run3.id, stepRunId: "step-3-n2", type: "model_call", timestamp: iso(run3Start + 1700), data: { model: "gpt-4o" } },
  { id: "e3-4", runId: run3.id, stepRunId: "step-3-n2", type: "tool_call", timestamp: iso(run3Start + 1750), data: { toolId: "read_file" } },
  { id: "e3-5", runId: run3.id, stepRunId: "step-3-n3", type: "model_call", timestamp: iso(run3Start + 1800), data: { model: "gpt-4o" } },
  { id: "e3-6", runId: run3.id, type: "flow_end", timestamp: iso(run3Start + 4100), data: { status: "failed" } },
];

// --- Run 4: PR #44, in progress (planner done, reviewers running) ---------------
const run4Start = -12 * 1000; // 12s ago
const run4: Run = {
  id: "run-demo-4",
  flowId: demoFlow.id,
  status: "running",
  startedAt: iso(run4Start),
  steps: [
    {
      id: "step-4-n1", runId: "run-demo-4", nodeId: "n1", agentId: "planner", status: "completed",
      input: { task: "Review PR #44. Add caching layer for user profile lookups." },
      output: { plan: ["Check cache invalidation logic", "Look for stale-data risks", "Approve if TTL sensible"] },
      startedAt: iso(run4Start), completedAt: iso(run4Start + 1700),
      usage: { inputTokens: 410, outputTokens: 160, estimatedCostUsd: 0.0089, latencyMs: 1700 },
      toolCalls: [],
    },
    {
      id: "step-4-n2", runId: "run-demo-4", nodeId: "n2", agentId: "code-reviewer", status: "running",
      input: { plan: "Check cache invalidation logic", files: ["src/cache/userProfile.ts"] },
      startedAt: iso(run4Start + 1700),
      toolCalls: [],
    },
    {
      id: "step-4-n3", runId: "run-demo-4", nodeId: "n3", agentId: "security-reviewer", status: "running",
      input: { plan: "Look for stale-data risks", files: ["src/cache/userProfile.ts"] },
      startedAt: iso(run4Start + 1700),
      toolCalls: [],
    },
    {
      id: "step-4-n4", runId: "run-demo-4", nodeId: "n4", agentId: "final-validator", status: "pending",
      input: {}, toolCalls: [],
    },
  ],
};

const run4Events: TraceEvent[] = [
  { id: "e4-1", runId: run4.id, type: "flow_start", timestamp: iso(run4Start), data: { flowId: demoFlow.id } },
  { id: "e4-2", runId: run4.id, stepRunId: "step-4-n1", type: "model_call", timestamp: iso(run4Start + 300), data: { model: "gpt-4o-mini" } },
  { id: "e4-3", runId: run4.id, stepRunId: "step-4-n1", type: "agent_end", timestamp: iso(run4Start + 1700), data: { agentId: "planner" } },
  { id: "e4-4", runId: run4.id, stepRunId: "step-4-n2", type: "node_start", timestamp: iso(run4Start + 1700), data: { nodeId: "n2" } },
  { id: "e4-5", runId: run4.id, stepRunId: "step-4-n3", type: "node_start", timestamp: iso(run4Start + 1700), data: { nodeId: "n3" } },
  { id: "e4-6", runId: run4.id, stepRunId: "step-4-n2", type: "model_call", timestamp: iso(run4Start + 1800), data: { model: "gpt-4o" } },
  { id: "e4-7", runId: run4.id, stepRunId: "step-4-n3", type: "model_call", timestamp: iso(run4Start + 1850), data: { model: "gpt-4o" } },
];

export const demoRuns: Run[] = [run1, run2, run3, run4];
export const demoTraceEvents: TraceEvent[] = [...run1Events, ...run2Events, ...run3Events, ...run4Events];

// Backwards-compat: some callers may still import the singular name.
export const demoRun: Run = run1;
