import { describe, expect, it } from "vitest";
import type { Run, TraceEvent } from "@agentlab/contracts";
import { summarizeRun, withCacheReadsFromTrace } from "../src/index.js";

const usage = (inputTokens: number) => ({ inputTokens, outputTokens: 100, estimatedCostUsd: 0.01, latencyMs: 1000 });
const run: Run = {
  id: "r1",
  flowId: "f1",
  status: "completed",
  startedAt: "2026-09-28T10:00:00.000Z",
  steps: [
    { id: "s1", nodeId: "a", agentId: "a", status: "completed", toolCalls: [], usage: usage(30_000) },
    { id: "s2", nodeId: "b", agentId: "b", status: "completed", toolCalls: [], usage: { ...usage(5_000), cacheReadTokens: 1_000 } },
  ],
  totalUsage: usage(35_000),
};
const modelCall = (stepRunId: string, cacheReadTokens: number, i: number): TraceEvent => ({
  id: `m${stepRunId}${i}`,
  runId: "r1",
  stepRunId,
  type: "model_call",
  timestamp: "2026-09-28T10:00:01.000Z",
  data: { inputTokens: 10_000, outputTokens: 50, cacheReadTokens },
});

describe("withCacheReadsFromTrace", () => {
  it("fills in cached tokens for older runs from their model calls, keeping recorded values", () => {
    const events = [modelCall("s1", 8_000, 1), modelCall("s1", 9_000, 2), modelCall("s2", 4_000, 1)];
    const filled = withCacheReadsFromTrace(run, events);
    expect(filled.steps.map((s) => s.usage?.cacheReadTokens)).toEqual([17_000, 1_000]);
    expect(filled.totalUsage?.cacheReadTokens).toBe(18_000);
    expect(summarizeRun(filled).cacheReadTokens).toBe(18_000);
  });

  it("leaves a run without model call traces unchanged", () => {
    expect(withCacheReadsFromTrace(run, [])).toBe(run);
  });
});
