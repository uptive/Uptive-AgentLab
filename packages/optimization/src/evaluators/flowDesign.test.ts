import { describe, expect, it } from "vitest";
import { analyzeRun, createEvaluators } from "../analyzeRun.js";
import { codeReviewFixture } from "../fixtures/codeReviewRun.js";
import type { JsonRequest, ModelClient } from "../types.js";
import { buildFlowFacts, createFlowDesignEvaluator, type FlowFinding } from "./flowDesign.js";

const finding = (overrides: Partial<FlowFinding> & Pick<FlowFinding, "check" | "change">): FlowFinding => ({
  nodeIds: [overrides.change.nodeId],
  title: "Title",
  problem: "Problem.",
  suggestion: "Suggestion.",
  severity: "medium",
  evidence: [],
  ...overrides,
});

function mockClient(findings: FlowFinding[]): ModelClient & { requests: JsonRequest[] } {
  const requests: JsonRequest[] = [];
  return {
    requests,
    async generateJson(request) {
      requests.push(request);
      return { findings };
    },
  };
}

const parallelize = finding({
  check: "parallelization",
  title: "Run Security Reviewer in parallel with Code Reviewer",
  change: { type: "set-dependencies", nodeId: "security-review", dependsOn: ["plan"], text: "" },
});

describe("Flow Design evaluator", () => {
  it("sends the whole graph with timings and which outputs each node reads", async () => {
    const facts = buildFlowFacts(codeReviewFixture);
    const security = facts.nodes.find((n) => n.nodeId === "security-review")!;
    expect(security).toMatchObject({
      dependsOn: ["code-review"],
      readsOutputOf: ["plan"],
      unusedDependencies: ["code-review"],
      startOffsetMs: 21_500,
      durationMs: 22_200,
    });
    expect(facts.terminalNodeIds).toEqual(["validate"]);

    const client = mockClient([]);
    await createFlowDesignEvaluator(client).evaluate(codeReviewFixture);
    expect(client.requests).toHaveLength(1);
    expect(client.requests[0].prompt).toContain('"unusedDependencies"');
    expect(client.requests[0].system).toMatch(/parallelization[\s\S]*duplicated-work[\s\S]*missing-validation[\s\S]*unclear-responsibilities/);
  });

  it("turns a parallelization finding into a Flow Design recommendation with a computed speed-up", async () => {
    const [rec] = await createFlowDesignEvaluator(mockClient([parallelize])).evaluate(codeReviewFixture);
    expect(rec).toMatchObject({
      id: "flow-design:parallelization:security-review",
      category: "flow-design",
      target: { kind: "node", nodeId: "security-review", agentId: "security-reviewer" },
      change: { type: "set-dependencies", path: "nodes.security-review.dependsOn", before: ["code-review"], after: ["plan"] },
    });
    // Critical path 52.6s → 38.1s: Security Reviewer (22.2s) now overlaps Code Reviewer (14.5s).
    expect(rec.estimatedImpact.speed).toEqual({ latencyMs: -14_500, stepLatencyMs: 0 });
  });

  it("drops findings that don't hold up against the graph", async () => {
    const recs = await createFlowDesignEvaluator(
      mockClient([
        // validate reads code-review's output, so that dependency can't go.
        finding({ check: "parallelization", change: { type: "set-dependencies", nodeId: "validate", dependsOn: ["security-review"], text: "" } }),
        // The flow already ends in the Final Validator.
        finding({ check: "missing-validation", nodeIds: [], change: { type: "add-node", nodeId: "qa", dependsOn: ["validate"], text: "Check output" } }),
        finding({ check: "duplicated-work", nodeIds: ["ghost", "plan"], change: { type: "merge-nodes", nodeId: "plan", dependsOn: [], text: "x" } }),
        // Wrong change type for the check.
        finding({ check: "parallelization", change: { type: "edit-role", nodeId: "plan", dependsOn: [], text: "x" } }),
      ]),
    ).evaluate(codeReviewFixture);
    expect(recs).toEqual([]);
  });

  it("appears alongside the other categories and feeds the projected latency", async () => {
    const result = await analyzeRun(codeReviewFixture, createEvaluators(mockClient([parallelize])));
    expect(new Set(result.recommendations.map((r) => r.category))).toEqual(
      new Set(["quality", "model-selection", "token-context", "flow-design"]),
    );
    expect(result.summary.byCategory["flow-design"]).toMatchObject({ count: 1, latencyMs: -14_500 });
    // All fixes together: parallel reviews plus the faster Security Reviewer and smaller inputs.
    expect(result.summary.projected.latencyMs).toBeLessThan(result.summary.baseline.latencyMs - 14_500 - 5_000);
  });
});
