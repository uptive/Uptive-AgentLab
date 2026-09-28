import { describe, expect, it } from "vitest";
import type { TraceEvent } from "@agentlab/contracts";
import { analyzeRun } from "../src/analyzeRun.js";
import { agentExecutionEvaluator } from "../src/evaluators/agentExecution.js";
import { codeReviewFixture } from "../src/fixtures/codeReviewRun.js";
import type { EvaluationInput } from "../src/types.js";

const codeStep = codeReviewFixture.run.steps.find((s) => s.nodeId === "code-review")!;

interface TurnSpec {
  inputTokens: number;
  tools?: { toolId: string; input: unknown; output?: unknown; failed?: boolean }[];
}

/** The code-review step's trace replaced by `turns`, recorded in the order the runtime emits them. */
function withTrace(turns: TurnSpec[]): EvaluationInput {
  let seq = 0;
  const event = (type: TraceEvent["type"], data: unknown): TraceEvent => ({
    id: `e${seq}`,
    runId: codeReviewFixture.run.id,
    stepRunId: codeStep.id,
    type,
    timestamp: new Date(Date.UTC(2026, 8, 28, 10, 0, seq++)).toISOString(),
    data,
  });
  const events = turns.flatMap(({ inputTokens, tools = [] }) => [
    ...tools.map((t) =>
      event("tool_call", { toolId: t.toolId, input: t.input, output: t.failed ? { error: "No such file" } : t.output, status: t.failed ? "failed" : "completed" }),
    ),
    event("model_call", { model: "claude-sonnet-5", inputTokens, outputTokens: 200, toolUses: tools.map((t) => t.toolId) }),
  ]);
  return { ...codeReviewFixture, events: [...(codeReviewFixture.events ?? []).filter((e) => e.stepRunId !== codeStep.id), ...events] };
}

const bigFile = "x".repeat(60_000); // ~15k tokens

describe("Agent execution evaluator", () => {
  it("finds nothing when steps don't record tool calls", async () => {
    expect(await agentExecutionEvaluator.evaluate(codeReviewFixture)).toEqual([]);
  });

  it("flags tool results that every later turn re-reads", async () => {
    const input = withTrace([
      { inputTokens: 3_000, tools: [{ toolId: "Read", input: { file_path: "a.ts" }, output: bigFile }] },
      { inputTokens: 18_000, tools: [{ toolId: "Read", input: { file_path: "b.ts" }, output: bigFile }] },
      { inputTokens: 33_000 },
      { inputTokens: 33_500 },
    ]);
    const recs = await agentExecutionEvaluator.evaluate(input);
    const heavy = recs.find((r) => r.id === "agent-execution:heavy-tool-results:code-review:Read");
    expect(heavy).toMatchObject({ category: "execution", severity: "high", change: { type: "edit-instructions", path: "systemInstructions" } });
    // a.ts is re-read by 3 later turns, b.ts by 2: 15k × 5 = 75k tokens.
    expect(heavy?.estimatedImpact.cost?.inputTokensPerRun).toBe(-75_000);
    expect(heavy?.tags).toEqual(expect.arrayContaining(["Context", "Tools"]));
    expect(String(heavy?.change.after)).toContain("offset and limit");
  });

  it("counts the full size of results the trace truncated", async () => {
    const truncated = `${"x".repeat(20_000)}… [truncated 40000 characters]`;
    const input = withTrace([
      { inputTokens: 3_000, tools: [{ toolId: "Bash", input: { command: "git diff" }, output: truncated }] },
      { inputTokens: 18_000 },
      { inputTokens: 18_500 },
    ]);
    const heavy = (await agentExecutionEvaluator.evaluate(input)).find((r) => r.id.includes("heavy-tool-results"));
    expect(heavy?.estimatedImpact.cost?.inputTokensPerRun).toBeLessThanOrEqual(-30_000);
  });

  it("flags a tool call repeated with the same input", async () => {
    const read = { toolId: "Read", input: { file_path: "a.ts" }, output: "short" };
    const recs = await agentExecutionEvaluator.evaluate(withTrace([{ inputTokens: 3_000, tools: [read] }, { inputTokens: 3_100, tools: [read] }, { inputTokens: 3_200 }]));
    expect(recs.map((r) => r.id)).toContain("agent-execution:repeated-tool-calls:code-review");
  });

  it("flags repeated failing tool calls with their errors", async () => {
    const recs = await agentExecutionEvaluator.evaluate(
      withTrace([
        { inputTokens: 3_000, tools: [{ toolId: "Read", input: { file_path: "missing.ts" }, failed: true }] },
        { inputTokens: 3_100, tools: [{ toolId: "Read", input: { file_path: "gone.ts" }, failed: true }] },
        { inputTokens: 3_200, tools: [{ toolId: "Read", input: { file_path: "a.ts" }, output: "ok" }] },
        { inputTokens: 3_300 },
      ]),
    );
    const failing = recs.find((r) => r.id === "agent-execution:failing-tool-calls:code-review");
    expect(failing).toMatchObject({ severity: "high", estimatedImpact: { reliability: { retriesAvoided: 2 } } });
    expect(failing?.evidence).toEqual(["Read: No such file"]);
  });

  it("flags turns spent only searching for files", async () => {
    const search = (pattern: string) => ({ inputTokens: 4_000, tools: [{ toolId: "Grep", input: { pattern }, output: "src/a.ts" }] });
    const recs = await agentExecutionEvaluator.evaluate(
      withTrace([search("foo"), search("bar"), { inputTokens: 4_000, tools: [{ toolId: "Bash", input: { command: "ls src" }, output: "a.ts" }] }, { inputTokens: 4_500 }]),
    );
    expect(recs.find((r) => r.id === "agent-execution:discovery-turns:code-review")?.evidence).toEqual([
      "Search-only turns: 1, 2, 3 (~12,000 input tokens).",
    ]);
  });

  it("is part of the default analysis", async () => {
    const input = withTrace([
      { inputTokens: 3_000, tools: [{ toolId: "Read", input: { file_path: "a.ts" }, output: bigFile }] },
      { inputTokens: 18_000 },
      { inputTokens: 18_500 },
    ]);
    const { recommendations, summary } = await analyzeRun(input);
    expect(recommendations.some((r) => r.category === "execution")).toBe(true);
    expect(summary.byCategory.execution.count).toBeGreaterThan(0);
  });
});
