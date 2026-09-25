import type { AgentDefinition, FlowDefinition, Run, StepRun, TraceEvent } from "@agentlab/contracts";
import { describe, expect, it } from "vitest";
import { analyzeRun } from "./analyzeRun.js";
import { consumedNodeOutputs, inputMappingOf, modelCallAttempts } from "./helpers.js";
import { toEvaluationInput } from "./runInput.js";
import { runTask } from "./evaluators/llmFacts.js";

// Shaped like the runs the flow engine records: nodes without inputMapping, a join node that gets
// `{ [depNodeId]: output }`, several model_call events per step (tool-use turns, not retries), the
// run input on the run, and flow/agent snapshots.
const T0 = Date.parse("2026-09-24T14:50:00.000Z");
const at = (ms: number) => new Date(T0 + ms).toISOString();

const agent = (id: string, name: string, role: string, model: string, systemInstructions: string): AgentDefinition =>
  ({
    id,
    name,
    role,
    model,
    systemInstructions,
    outputSchema: { type: "object", properties: id === "planner" ? { changeSummary: {}, riskAreas: {} } : id === "final-validator" ? { verdict: {}, reasons: {} } : { findings: {}, summary: {} } },
    tools: [],
    skills: [],
  }) as unknown as AgentDefinition;

const agents = [
  // Roles are labels (two agents share "reviewer"); what each does is in its instructions.
  agent("planner", "Planner", "planner", "claude-opus-5", "Summarize the pull request and list the risk areas each reviewer should focus on."),
  agent("code-reviewer", "Code Reviewer", "reviewer", "claude-sonnet-5", "Check correctness, readability, naming and test coverage of the diff. Cite file and line for every finding."),
  agent("security-reviewer", "Security Reviewer", "reviewer", "claude-sonnet-5", "Look for injection, broken authentication, secrets in code and data exposure. Rate each vulnerability by exploitability."),
  agent("final-validator", "Final Validator", "validator", "claude-sonnet-5", "Merge both reviews into a verdict: approve or request changes, with the blocking reasons."),
];

const flow: FlowDefinition = {
  id: "code-review-flow",
  name: "Code review",
  nodes: [
    { id: "n1", agentId: "planner", dependsOn: [] },
    { id: "n2", agentId: "code-reviewer", dependsOn: ["n1"] },
    { id: "n3", agentId: "security-reviewer", dependsOn: ["n1"] },
    { id: "n4", agentId: "final-validator", dependsOn: ["n2", "n3"] },
  ],
};

const runInput = { title: "Add user lookup endpoint", description: "Adds findUser.", diff: "diff --git a/src/users.ts b/src/users.ts\n+export async function findUser() {}" };
const plan = { changeSummary: "Adds findUser.", riskAreas: ["SQL injection"] };
const review = { findings: [{ severity: "high", issue: "SQL injection" }], summary: "Unsafe query." };

function step(id: string, nodeId: string, agentId: string, start: number, end: number, input: unknown, output: unknown): StepRun {
  return {
    id,
    runId: "run-real",
    nodeId,
    agentId,
    status: "completed",
    input,
    output,
    startedAt: at(start),
    completedAt: at(end),
    usage: { inputTokens: 10_000, outputTokens: 1_500, estimatedCostUsd: 0.04, latencyMs: end - start },
    toolCalls: [],
  };
}

const run: Run = {
  id: "run-real",
  flowId: flow.id,
  status: "completed",
  startedAt: at(0),
  completedAt: at(60_000),
  input: runInput,
  flow,
  agents,
  authSource: "subscription",
  totalUsage: { inputTokens: 40_000, outputTokens: 6_000, estimatedCostUsd: 0.16, latencyMs: 60_000 },
  steps: [
    step("s1", "n1", "planner", 0, 28_000, runInput, plan),
    // The step itself didn't keep its input; the agent_start event did.
    { ...step("s2", "n2", "code-reviewer", 28_000, 52_000, undefined, review), input: undefined },
    step("s3", "n3", "security-reviewer", 28_000, 50_000, plan, review),
    step("s4", "n4", "final-validator", 52_000, 60_000, { n2: review, n3: review }, { verdict: "request-changes", reasons: ["SQL injection"] }),
  ],
};

const event = (id: string, stepRunId: string, type: TraceEvent["type"], data: unknown): TraceEvent => ({ id, runId: run.id, stepRunId, type, timestamp: at(0), data });
const events: TraceEvent[] = [
  event("e1", "s2", "agent_start", { agentId: "code-reviewer", input: plan }),
  // Two successful turns (tool use, then StructuredOutput): not a retry.
  event("e2", "s3", "model_call", { model: "claude-sonnet-5", inputTokens: 7458, outputTokens: 2, toolUses: ["Grep"] }),
  event("e3", "s3", "model_call", { model: "claude-sonnet-5", inputTokens: 8123, outputTokens: 1, toolUses: ["StructuredOutput"] }),
];

function load() {
  const result = toEvaluationInput(run, events);
  if ("reason" in result) throw new Error(result.reason);
  return result.input;
}

describe("toEvaluationInput", () => {
  it("uses the run's snapshots and fills in step inputs from the trace", () => {
    const input = load();
    expect(input.flow).toBe(flow);
    expect(input.agents.map((a) => a.id)).toEqual(["planner", "code-reviewer", "security-reviewer", "final-validator"]);
    expect(input.run.steps.find((s) => s.nodeId === "n2")?.input).toEqual(plan);
    expect(input.events).toHaveLength(3);
  });

  it("needs the run's own flow, but can look up agents it didn't save", () => {
    expect(toEvaluationInput({ ...run, flow: undefined }, events)).toEqual({ reason: "it was recorded before runs saved a copy of their flow" });
    const result = toEvaluationInput({ ...run, agents: undefined }, events, { findAgent: (id) => agents.find((a) => a.id === id) });
    expect("input" in result && result.input.agents).toHaveLength(4);
  });

  it("says why a run can't be analyzed", () => {
    expect(toEvaluationInput({ ...run, status: "running" })).toEqual({ reason: "the run is running" });
    expect(toEvaluationInput({ ...run, steps: run.steps.map((s) => ({ ...s, usage: undefined })) })).toEqual({ reason: "no step recorded token usage" });
  });
});

describe("evaluators on an engine-recorded run", () => {
  it("derives input mappings the way the flow engine passes input", () => {
    const input = load();
    const [n1, n2, , n4] = flow.nodes;
    expect(inputMappingOf(input, n1)).toEqual({ title: "$input.title", description: "$input.description", diff: "$input.diff" });
    expect(inputMappingOf(input, n2)).toEqual({ changeSummary: "n1.changeSummary", riskAreas: "n1.riskAreas" });
    expect(inputMappingOf(input, n4)).toEqual({ n2: "n2", n3: "n3" });
    expect(consumedNodeOutputs(input, n4)).toEqual(["n2", "n3"]);
  });

  it("counts only failed model calls as retries", () => {
    const input = load();
    expect(modelCallAttempts(input, input.run.steps[2])).toBe(1);
  });

  it("uses the run input as the task when it has no task field", () => {
    expect(runTask(load())).toEqual(runInput);
  });

  it("doesn't report handoff, parallelization, duplication or retry problems that aren't there", async () => {
    const { recommendations } = await analyzeRun(load());
    const ids = recommendations.map((r) => r.id);
    expect(ids.filter((id) => /broken-handoff|parallelization|duplicated-work|underpowered/.test(id))).toEqual([]);
  });
});
