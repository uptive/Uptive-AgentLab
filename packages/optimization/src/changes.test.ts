import type { Recommendation } from "@agentlab/contracts";
import { describe, expect, it } from "vitest";
import { analyzeRun } from "./analyzeRun.js";
import { conflictsWith, notTestableReason, planChanges } from "./changes.js";
import { codeReviewFixture } from "./fixtures/codeReviewRun.js";
import type { EvaluationInput } from "./types.js";

async function recommendations() {
  const { recommendations } = await analyzeRun(codeReviewFixture);
  return (id: string) => recommendations.find((r) => r.id === id)!;
}

describe("planChanges", () => {
  it("edits copies of the agents and flow, never the analyzed run", async () => {
    const rec = await recommendations();
    const before = structuredClone(codeReviewFixture);
    const plan = planChanges(codeReviewFixture, [rec("model-selection:overpowered:plan"), rec("flow-design:parallelization:security-review")]);

    expect(plan.agents.find((a) => a.id === "planner")?.model).toBe("claude-haiku-4-5");
    expect(plan.flow.nodes.find((n) => n.id === "security-review")?.dependsOn).toEqual(["plan"]);
    expect(plan.edits.map((e) => [e.target.kind === "run-input" ? "run" : e.target.name, e.field, e.before, e.after])).toEqual([
      ["Planner", "model", "claude-opus-5-5", "claude-haiku-4-5"],
      ["Security Reviewer", "dependsOn", ["code-review"], ["plan"]],
    ]);
    expect(codeReviewFixture).toEqual(before);
  });

  it("removes a mapped input", async () => {
    const rec = await recommendations();
    const plan = planChanges(codeReviewFixture, [rec("token-context:redundant-fan-in:validate:diff")]);
    const mapping = plan.flow.nodes.find((n) => n.id === "validate")!.inputMapping!;
    expect(mapping).not.toHaveProperty("diff");
    expect(mapping).toHaveProperty("codeFindings", "code-review.findings");
  });

  it("explains what can't be tested automatically, and skips it", async () => {
    const rec = await recommendations();
    const replace = rec("token-context:oversized-planning-input:plan:diff");
    const vague = rec("quality:vague-instructions:security-review");
    const placeholder: Recommendation = { ...vague, change: { ...vague.change, after: "Check: <what this step must check>." } };
    expect(notTestableReason(codeReviewFixture, replace)).toBe("it needs a new step that produces the summary");
    expect(notTestableReason(codeReviewFixture, vague)).toBeUndefined();
    expect(notTestableReason(codeReviewFixture, placeholder)).toBe("the suggested instructions contain placeholders to fill in");

    const plan = planChanges(codeReviewFixture, [replace]);
    expect(plan.edits).toEqual([]);
    expect(plan.skipped).toEqual([{ recommendationId: replace.id, reason: "it needs a new step that produces the summary" }]);
  });

  it("allows only one edit per field", async () => {
    const rec = await recommendations();
    const a = rec("model-selection:overpowered:plan");
    const b: Recommendation = { ...a, id: "other", change: { ...a.change, after: "claude-sonnet-5" } };
    expect(conflictsWith(a, [a, b])).toEqual([b]);
    const plan = planChanges(codeReviewFixture, [a, b]);
    expect(plan.edits).toHaveLength(1);
    expect(plan.skipped[0]).toMatchObject({ recommendationId: "other", reason: "another selected change edits the same field" });
  });

  it("pins the implicit input of a step before changing what it runs after", () => {
    const flow = {
      ...codeReviewFixture.flow,
      nodes: [
        { id: "a", agentId: "planner", dependsOn: [] },
        { id: "b", agentId: "code-reviewer", dependsOn: ["a"] },
        { id: "c", agentId: "final-validator", dependsOn: ["a", "b"] },
      ],
    };
    const input: EvaluationInput = {
      ...codeReviewFixture,
      flow,
      run: {
        ...codeReviewFixture.run,
        steps: [
          { ...codeReviewFixture.run.steps[0], nodeId: "a" },
          { ...codeReviewFixture.run.steps[1], nodeId: "b" },
          { ...codeReviewFixture.run.steps[3], nodeId: "c", input: { a: {}, b: {} } },
        ],
      },
    };
    const r = { id: "x", target: { kind: "node", nodeId: "c", agentId: "final-validator" }, change: { type: "set-dependencies", path: "nodes.c.dependsOn", before: ["a", "b"], after: ["b"] } } as Recommendation;
    const node = planChanges(input, [r]).flow.nodes.find((n) => n.id === "c")!;
    // Without pinning, the engine would pass b's output directly instead of { b: output }.
    expect(node).toMatchObject({ dependsOn: ["b"], inputMapping: { b: "b" } });
  });
});
