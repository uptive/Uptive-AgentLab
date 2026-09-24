import { describe, expect, it } from "vitest";
import type { AgentDefinition, AgentRuntime, FlowDefinition, TraceEvent } from "@agentlab/contracts";
import { codeReviewFlow, createFlowEngine, dummyAgentRegistry, FlowValidationError } from "../src/index.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Records start/end order and echoes inputs so handoffs can be asserted. */
function recordingRuntime(opts: { delays?: Record<string, number>; fail?: string[] } = {}) {
  const log: string[] = [];
  let active = 0;
  let maxActive = 0;
  const runtime: AgentRuntime = {
    async run(agent: AgentDefinition, input, context) {
      log.push(`start:${agent.id}`);
      active++;
      maxActive = Math.max(maxActive, active);
      await sleep(opts.delays?.[agent.id] ?? 10);
      active--;
      log.push(`end:${agent.id}`);
      const usage = { inputTokens: 10, outputTokens: 5, estimatedCostUsd: 0.01, latencyMs: 1 };
      if (opts.fail?.includes(agent.id)) {
        return { agentId: agent.id, status: "failed", output: undefined, error: "boom", usage, toolCalls: [] };
      }
      return {
        agentId: agent.id,
        status: "completed",
        output: { from: agent.id, input, priorKeys: Object.keys(context.priorOutputs ?? {}) },
        usage,
        toolCalls: [],
      };
    },
  };
  return { runtime, log, maxActive: () => maxActive };
}

const makeEngine = (runtime: AgentRuntime, extra: Partial<Parameters<typeof createFlowEngine>[0]> = {}) =>
  createFlowEngine({ runtime, resolveAgent: dummyAgentRegistry.get, ...extra });

describe("createFlowEngine", () => {
  it("runs sequential, parallel and join steps in order", async () => {
    const rec = recordingRuntime({ delays: { "code-reviewer": 30, "security-reviewer": 10 } });
    const run = await makeEngine(rec.runtime).execute(codeReviewFlow, { prompt: "PR #42" });

    expect(run.status).toBe("completed");
    expect(run.steps.every((s) => s.status === "completed")).toBe(true);

    const idx = (e: string) => rec.log.indexOf(e);
    // Sequential: both reviewers start after the planner finishes.
    expect(idx("start:code-reviewer")).toBeGreaterThan(idx("end:planner"));
    expect(idx("start:security-reviewer")).toBeGreaterThan(idx("end:planner"));
    // Parallel: both reviewers start before either finishes.
    expect(idx("start:security-reviewer")).toBeLessThan(idx("end:code-reviewer"));
    expect(rec.maxActive()).toBe(2);
    // Join: the validator waits for the slower reviewer.
    expect(idx("start:final-validator")).toBeGreaterThan(idx("end:code-reviewer"));
    expect(idx("start:final-validator")).toBeGreaterThan(idx("end:security-reviewer"));
  });

  it("passes outputs between steps", async () => {
    const rec = recordingRuntime();
    const run = await makeEngine(rec.runtime).execute(codeReviewFlow, { prompt: "PR #42" });
    const step = (id: string) => run.steps.find((s) => s.nodeId === id)!;

    expect(step("plan").input).toEqual({ prompt: "PR #42" });
    expect(step("code-review").input).toEqual(step("plan").output);
    expect(step("validate").input).toEqual({
      "code-review": step("code-review").output,
      "security-review": step("security-review").output,
    });
    expect((step("validate").output as { priorKeys: string[] }).priorKeys).toEqual(["code-review", "security-review"]);
  });

  it("applies inputMapping", async () => {
    const flow: FlowDefinition = {
      id: "m",
      name: "m",
      nodes: [
        { id: "a", agentId: "planner", dependsOn: [] },
        { id: "b", agentId: "summarizer", dependsOn: ["a"], inputMapping: { task: "$input.prompt", planner: "a.from" } },
      ],
    };
    const run = await makeEngine(recordingRuntime().runtime).execute(flow, { prompt: "hi" });
    expect(run.steps[1].input).toEqual({ task: "hi", planner: "planner" });
  });

  it("stops downstream of a failure but finishes independent branches", async () => {
    const rec = recordingRuntime({ fail: ["security-reviewer"] });
    const run = await makeEngine(rec.runtime).execute(codeReviewFlow, {});
    const status = Object.fromEntries(run.steps.map((s) => [s.nodeId, s.status]));

    expect(run.status).toBe("failed");
    expect(status).toEqual({ plan: "completed", "code-review": "completed", "security-review": "failed", validate: "pending" });
    expect(run.steps.find((s) => s.nodeId === "security-review")!.error).toBe("boom");
  });

  it("treats unknown agents and thrown errors as step failures", async () => {
    const flow: FlowDefinition = { id: "u", name: "u", nodes: [{ id: "a", agentId: "ghost", dependsOn: [] }] };
    const run = await makeEngine(recordingRuntime().runtime).execute(flow, {});
    expect(run.status).toBe("failed");
    expect(run.steps[0].error).toMatch(/Unknown agent/);

    const throwing: AgentRuntime = { run: async () => { throw new Error("kaput"); } };
    const run2 = await makeEngine(throwing).execute(codeReviewFlow, {});
    expect(run2.steps[0]).toMatchObject({ status: "failed", error: "kaput" });
  });

  it("respects maxConcurrency", async () => {
    const rec = recordingRuntime();
    await makeEngine(rec.runtime, { maxConcurrency: 1 }).execute(codeReviewFlow, {});
    expect(rec.maxActive()).toBe(1);
  });

  it("emits trace events and run snapshots", async () => {
    const events: TraceEvent[] = [];
    const statuses: string[] = [];
    await makeEngine(recordingRuntime().runtime, { onEvent: (e) => events.push(e) }).execute(
      codeReviewFlow,
      {},
      { onRunUpdate: (r) => statuses.push(r.steps.find((s) => s.nodeId === "validate")!.status) },
    );

    expect(events[0].type).toBe("flow_start");
    expect(events.at(-1)!.type).toBe("flow_end");
    expect(events.filter((e) => e.type === "node_start")).toHaveLength(4);
    expect(events.filter((e) => e.type === "node_end")).toHaveLength(4);
    expect(statuses[0]).toBe("pending");
    expect(statuses).toContain("running");
    expect(statuses.at(-1)).toBe("completed");
  });

  it("aggregates usage", async () => {
    const run = await makeEngine(recordingRuntime().runtime).execute(codeReviewFlow, {});
    expect(run.totalUsage).toMatchObject({ inputTokens: 40, outputTokens: 20 });
    expect(run.totalUsage!.estimatedCostUsd).toBeCloseTo(0.04);
  });

  it("rejects invalid flows before running", async () => {
    const bad: FlowDefinition = { id: "b", name: "b", nodes: [{ id: "a", agentId: "planner", dependsOn: ["a"] }] };
    await expect(makeEngine(recordingRuntime().runtime).execute(bad, {})).rejects.toBeInstanceOf(FlowValidationError);
  });
});
