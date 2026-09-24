import { describe, expect, it } from "vitest";
import { analyzeRun, defaultEvaluators } from "./analyzeRun.js";
import { codeReviewFixture } from "./fixtures/codeReviewRun.js";
import type { Evaluator } from "./types.js";

describe("analyzeRun on the PR-review fixture", () => {
  it("recommends a smaller model for the Planner with a 70% cost reduction", async () => {
    const { recommendations } = await analyzeRun(codeReviewFixture);
    const planner = recommendations.find((r) => r.id === "model-selection:overpowered:plan");

    expect(planner).toBeDefined();
    expect(planner!.category).toBe("model-selection");
    expect(planner!.target).toEqual({ kind: "node", nodeId: "plan", agentId: "planner" });
    expect(planner!.problem).toMatch(/^Planner uses a strong and expensive model .* even though the step is mainly structured planning\.$/);
    expect(planner!.suggestion).toMatch(/^Try a smaller model/);
    expect(planner!.change).toEqual({ type: "set-model", path: "model", before: "claude-opus-5-5", after: "claude-haiku-4-5" });
    expect(planner!.estimatedImpact.cost?.percent).toBe(-70);
    expect(planner!.estimatedImpact.summary).toBe("Estimated cost reduction: 70%");
  });

  it("finds the broken Security Reviewer → Final Validator handoff and proposes a schema", async () => {
    const { recommendations } = await analyzeRun(codeReviewFixture);
    const handoff = recommendations.find((r) => r.id === "quality:broken-handoff:validate:securityFindings");
    expect(handoff?.category).toBe("quality");
    expect(handoff?.severity).toBe("high");
    expect(handoff?.target).toEqual({ kind: "node", nodeId: "security-review", agentId: "security-reviewer" });
    expect(handoff?.change.type).toBe("add-output-schema");
    expect(handoff?.change.after).toMatchObject({ required: ["findings"] });
  });

  it("measures speed on the critical path", async () => {
    const { recommendations } = await analyzeRun(codeReviewFixture);
    const retry = recommendations.find((r) => r.id === "model-selection:underpowered:security-review")!;
    // Security Reviewer runs after Code Reviewer, so the whole step saving reaches the run.
    expect(retry.estimatedImpact.speed).toEqual({ stepLatencyMs: -11_100, latencyMs: -11_100 });
    expect(retry.estimatedImpact.reliability).toEqual({ retriesAvoided: 1 });
  });

  it("summarizes per category with same-node savings compounded", async () => {
    const { summary, recommendations } = await analyzeRun(codeReviewFixture);
    const planStep = codeReviewFixture.run.steps.find((s) => s.nodeId === "plan")!;
    const validateStep = codeReviewFixture.run.steps.find((s) => s.nodeId === "validate")!;
    const saved = planStep.usage!.estimatedCostUsd * (1 - 0.3 * 0.4) + validateStep.usage!.estimatedCostUsd * 0.5;

    expect(summary.projected.costUsd).toBeCloseTo(summary.baseline.costUsd - saved, 6);
    expect(summary.byCategory["model-selection"].usdPerRun).toBeCloseTo(-planStep.usage!.estimatedCostUsd * 0.7, 6);
    expect(summary.byCategory.quality).toMatchObject({ count: 3, highestSeverity: "high" });
    expect(summary.byCategory["flow-design"].count).toBe(0);
    expect(summary.projected.latencyMs).toBeLessThan(summary.baseline.latencyMs - 11_100);
    expect(summary.topRecommendationIds).toEqual(recommendations.slice(0, 3).map((r) => r.id));
    expect(summary.topRecommendationIds[0]).toBe("quality:broken-handoff:validate:securityFindings");
  });

  it("reports a failing evaluator as skipped and keeps the others", async () => {
    const failing: Evaluator = {
      id: "flow-design",
      name: "Flow Design",
      category: "flow-design",
      evaluate: () => Promise.reject(new Error("No Claude API credentials")),
    };
    const { recommendations, skippedEvaluators } = await analyzeRun(codeReviewFixture, [failing, ...defaultEvaluators]);
    expect(skippedEvaluators).toEqual([{ evaluatorId: "flow-design", category: "flow-design", reason: "No Claude API credentials" }]);
    expect(recommendations.length).toBeGreaterThan(0);
  });

  it("gives every recommendation a category, title, change and a real target node", async () => {
    const { recommendations } = await analyzeRun(codeReviewFixture);
    const nodeIds = new Set(codeReviewFixture.flow.nodes.map((n) => n.id));

    expect(new Set(recommendations.map((r) => r.id)).size).toBe(recommendations.length);
    for (const r of recommendations) {
      expect(["quality", "model-selection", "token-context", "flow-design"]).toContain(r.category);
      expect(r.title.length).toBeGreaterThan(0);
      expect(r.change.type).toBeTruthy();
      expect(r.target.kind === "node" && nodeIds.has(r.target.nodeId)).toBe(true);
    }
  });
});
