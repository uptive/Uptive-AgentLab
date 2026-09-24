import { describe, expect, it } from "vitest";
import type { AgentDefinition, FlowDefinition } from "@agentlab/contracts";
import { analyzeRun } from "../analyzeRun.js";
import { codeReviewFixture } from "../fixtures/codeReviewRun.js";
import type { EvaluationInput } from "../types.js";
import { flowDesignEvaluator } from "./flowDesign.js";

function withFlow(flow: Partial<FlowDefinition>, agents: AgentDefinition[] = codeReviewFixture.agents): EvaluationInput {
  return { ...codeReviewFixture, flow: { ...codeReviewFixture.flow, ...flow }, agents };
}

describe("Flow Design evaluator", () => {
  it("suggests running Security Reviewer in parallel with Code Reviewer", async () => {
    const recs = await flowDesignEvaluator.evaluate(codeReviewFixture);
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({
      id: "flow-design:parallelization:security-review",
      category: "flow-design",
      title: "Run Security Reviewer in parallel with Code Reviewer",
      severity: "high",
      target: { kind: "node", nodeId: "security-review", agentId: "security-reviewer" },
      change: { type: "set-dependencies", path: "nodes.security-review.dependsOn", before: ["code-review"], after: ["plan"] },
    });
    // Critical path 52.6s → 38.1s: Security Reviewer (22.2s) now overlaps Code Reviewer (14.5s).
    expect(recs[0].estimatedImpact.speed).toEqual({ latencyMs: -14_500, stepLatencyMs: 0 });
  });

  it("keeps dependencies whose output is read", async () => {
    const parallel = withFlow({
      nodes: codeReviewFixture.flow.nodes.map((n) => (n.id === "security-review" ? { ...n, dependsOn: ["plan"] } : n)),
    });
    expect(await flowDesignEvaluator.evaluate(parallel)).toEqual([]);
  });

  it("flags a flow that ends without validation", async () => {
    const recs = await flowDesignEvaluator.evaluate(
      withFlow({ nodes: codeReviewFixture.flow.nodes.filter((n) => n.id !== "validate").map((n) => (n.id === "security-review" ? { ...n, dependsOn: ["plan"] } : n)) }),
    );
    expect(recs.map((r) => r.id)).toEqual(["flow-design:missing-validation"]);
    expect(recs[0].change).toMatchObject({ type: "add-node", after: { dependsOn: ["code-review", "security-review"] } });
  });

  it("flags the same agent running twice as duplicated work", async () => {
    const plan = codeReviewFixture.flow.nodes[0];
    const recs = await flowDesignEvaluator.evaluate(withFlow({ nodes: [...codeReviewFixture.flow.nodes, { ...plan, id: "plan-again", dependsOn: ["plan"] }] }));
    expect(recs.map((r) => r.id)).toContain("flow-design:duplicated-work:plan:plan-again");
  });

  it("flags agents whose roles overlap", async () => {
    const agents = codeReviewFixture.agents.map((a) =>
      a.id === "security-reviewer" ? { ...a, role: "Reviews correctness, error handling and security of the change." } : a,
    );
    const recs = await flowDesignEvaluator.evaluate({ ...codeReviewFixture, agents });
    expect(recs.map((r) => r.id)).toContain("flow-design:unclear-responsibilities:code-review:security-review");
  });

  it("appears alongside the other categories and feeds the projected latency", async () => {
    const result = await analyzeRun(codeReviewFixture);
    expect(new Set(result.recommendations.map((r) => r.category))).toEqual(
      new Set(["quality", "model-selection", "token-context", "flow-design"]),
    );
    expect(result.summary.byCategory["flow-design"]).toMatchObject({ count: 1, latencyMs: -14_500 });
    expect(result.summary.projected.latencyMs).toBeLessThan(result.summary.baseline.latencyMs - 14_500 - 5_000);

    // Timeline: with all fixes, Security Reviewer starts when Planner ends, alongside Code Reviewer.
    const at = (nodeId: string) => result.summary.timeline.find((t) => t.nodeId === nodeId)!;
    expect(at("security-review").measured.startMs).toBe(21_500);
    expect(at("security-review").projected.startMs).toBe(at("plan").projected.endMs);
    expect(at("code-review").projected.startMs).toBe(at("plan").projected.endMs);
  });
});
