import { describe, expect, it, vi } from "vitest";
import { analyzeRun, createEvaluators } from "../analyzeRun.js";
import { codeReviewFixture } from "../fixtures/codeReviewRun.js";
import type { JsonRequest, ModelClient } from "../types.js";
import { buildModelSelectionFacts, createModelSelectionLlmEvaluator } from "./modelSelectionLlm.js";
import { buildQualityFacts, createQualityLlmEvaluator } from "./qualityLlm.js";

function mockClient(findings: unknown[]): ModelClient & { requests: JsonRequest[] } {
  const requests: JsonRequest[] = [];
  return {
    requests,
    async generateJson(request) {
      requests.push(request);
      return { findings };
    },
  };
}

const qualityFinding = (overrides: Record<string, unknown>) => ({
  check: "instructions",
  targetNodeId: "security-review",
  consumerNodeId: "",
  field: "",
  title: "Title",
  problem: "Problem.",
  suggestion: "Suggestion.",
  severity: "medium",
  evidence: [],
  changeType: "edit-instructions",
  proposal: "New instructions.",
  expectedEffect: "Better output.",
  ...overrides,
});

describe("LLM-backed Model Selection", () => {
  it("sends each step's model, usage and retries, and prices the suggested model in code", async () => {
    const facts = buildModelSelectionFacts(codeReviewFixture);
    expect(facts.steps.find((s) => s.nodeId === "security-review")).toMatchObject({ attempts: 2, agent: { model: "claude-haiku-4-5" } });
    expect(facts.availableModels.map((m) => m.id)).toContain("claude-haiku-4-5");

    const client = mockClient([
      {
        nodeId: "plan",
        recommendedModel: "claude-haiku-4-5",
        problem: "Planner uses a strong and expensive model even though the step is mainly structured planning.",
        suggestion: "Try a smaller model.",
        severity: "high",
        evidence: ["420 output tokens against a schema"],
      },
      { nodeId: "plan", recommendedModel: "claude-opus-5-5", problem: "", suggestion: "", severity: "low", evidence: [] },
      { nodeId: "ghost", recommendedModel: "claude-haiku-4-5", problem: "", suggestion: "", severity: "low", evidence: [] },
    ]);
    const recs = await createModelSelectionLlmEvaluator(client).evaluate(codeReviewFixture);

    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({
      id: "model-selection:overpowered:plan",
      category: "model-selection",
      title: "Planner → Claude Haiku 4.5",
      change: { type: "set-model", before: "claude-opus-5-5", after: "claude-haiku-4-5" },
      estimatedImpact: { cost: { percent: -70 }, summary: "Estimated cost reduction: 70%" },
    });
  });
});

describe("LLM-backed Quality", () => {
  it("sends every handoff with the value actually passed, and flags missing ones", () => {
    const handoff = buildQualityFacts(codeReviewFixture).handoffs.find((h) => h.field === "securityFindings")!;
    expect(handoff).toMatchObject({ consumerNodeId: "validate", producerNodeId: "security-review", missing: true, valuePassedToConsumer: null });
  });

  it("accepts a faulty (not missing) handoff and keeps the rule-based missing-field finding", async () => {
    const client = mockClient([
      qualityFinding({
        check: "handoff",
        targetNodeId: "code-review",
        consumerNodeId: "validate",
        field: "codeFindings",
        title: "Pass fix details to the validator",
        changeType: "add-output-schema",
        proposal: JSON.stringify({ type: "object", required: ["findings"] }),
      }),
      qualityFinding({ check: "handoff", consumerNodeId: "validate", field: "notAField" }),
      qualityFinding({ changeType: "add-output-schema", proposal: "not json" }),
    ]);
    const recs = await createQualityLlmEvaluator(client).evaluate(codeReviewFixture);

    expect(recs.map((r) => r.id).sort()).toEqual(["quality:broken-handoff:validate:codeFindings", "quality:broken-handoff:validate:securityFindings"]);
    expect(recs.find((r) => r.id.endsWith("codeFindings"))).toMatchObject({
      target: { nodeId: "code-review" },
      change: { type: "add-output-schema", after: { required: ["findings"] } },
    });
  });

  it("validates proposed input mappings against the flow", async () => {
    const recs = await createQualityLlmEvaluator(
      mockClient([
        qualityFinding({ changeType: "edit-input-mapping", targetNodeId: "validate", proposal: JSON.stringify({ findings: "security-review.output" }) }),
        qualityFinding({ check: "final-output", changeType: "edit-input-mapping", targetNodeId: "validate", proposal: JSON.stringify({ x: "ghost.output" }) }),
      ]),
    ).evaluate(codeReviewFixture);
    expect(recs.map((r) => r.id)).toContain("quality:instructions:validate");
    expect(recs.map((r) => r.id)).not.toContain("quality:final-output:validate");
  });
});

describe("analyzeRun with model-backed evaluators", () => {
  it("falls back to the built-in rules when the model is unavailable", async () => {
    const failing: ModelClient = { generateJson: () => Promise.reject(new Error("Claude Code is not logged in.")) };
    const result = await analyzeRun(codeReviewFixture, createEvaluators(failing));

    expect(result.skippedEvaluators).toEqual([]);
    expect(result.fallbackEvaluators).toEqual([
      { evaluatorId: "quality", category: "quality", reason: "Claude Code is not logged in." },
      { evaluatorId: "model-selection", category: "model-selection", reason: "Claude Code is not logged in." },
    ]);
    expect(result.recommendations.map((r) => r.id)).toContain("model-selection:overpowered:plan");
    expect(result.recommendations.map((r) => r.id)).toContain("quality:broken-handoff:validate:securityFindings");
  });

  it("reports progress as each evaluator starts and finishes", async () => {
    const failing: ModelClient = { generateJson: () => Promise.reject(new Error("usage limit")) };
    const events: string[] = [];
    await analyzeRun(codeReviewFixture, createEvaluators(failing), {
      onProgress: (p) => events.push(`${p.evaluatorId}:${p.status}${p.modelBacked ? "(model)" : ""}`),
    });
    expect(events.slice(0, 4)).toEqual(["quality:running(model)", "model-selection:running(model)", "token-context:running", "flow-design:running"]);
    expect(events).toEqual(
      expect.arrayContaining(["quality:fallback(model)", "model-selection:fallback(model)", "token-context:done", "flow-design:done"]),
    );
    expect(events).toHaveLength(8);
  });

  it("makes one model call per model-backed evaluator", async () => {
    const client = mockClient([]);
    const spy = vi.spyOn(client, "generateJson");
    await analyzeRun(codeReviewFixture, createEvaluators(client));
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe("tags from model-backed evaluators", () => {
  it("asks for tags from the fixed list and drops invented ones", async () => {
    const client = mockClient([qualityFinding({ tags: ["Instructions", "Made-up", "Output", "Instructions"] })]);
    const [rec] = await createQualityLlmEvaluator(client).evaluate(codeReviewFixture);

    expect(client.requests[0].system).toMatch(/don't invent new tags/);
    expect(JSON.stringify(client.requests[0].schema)).toContain('"Responsibility"');
    expect(rec).toMatchObject({ category: "quality", tags: ["Output", "Instructions"] });
  });

  it("adds the tags a model change measurably affects", async () => {
    const client = mockClient([
      { nodeId: "plan", recommendedModel: "claude-haiku-4-5", problem: "P.", suggestion: "S.", severity: "high", tags: [], evidence: [] },
    ]);
    const [rec] = await createModelSelectionLlmEvaluator(client).evaluate(codeReviewFixture);
    expect(rec).toMatchObject({ category: "model-selection", tags: ["Cost", "Speed"] });
  });
});
