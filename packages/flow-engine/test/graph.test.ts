import { describe, expect, it } from "vitest";
import type { FlowDefinition } from "@agentlab/contracts";
import { codeReviewFlow, topologicalLevels, validateFlow, wouldCreateCycle } from "../src/index.js";

const flow = (nodes: FlowDefinition["nodes"]): FlowDefinition => ({ id: "f", name: "f", nodes });

describe("validateFlow", () => {
  it("accepts the demo flow", () => {
    expect(validateFlow(codeReviewFlow, { knownAgentIds: ["planner", "code-reviewer", "security-reviewer", "final-validator"] }))
      .toEqual({ valid: true, errors: [] });
  });

  it("reports empty flows, duplicates, missing deps and unknown agents", () => {
    expect(validateFlow(flow([])).errors.map((e) => e.code)).toEqual(["EMPTY_FLOW"]);

    const codes = validateFlow(
      flow([
        { id: "a", agentId: "x", dependsOn: [] },
        { id: "a", agentId: "x", dependsOn: [] },
        { id: "b", agentId: "nope", dependsOn: ["zzz", "b"] },
      ]),
      { knownAgentIds: ["x"] },
    ).errors.map((e) => e.code);
    expect(codes).toEqual(expect.arrayContaining(["DUPLICATE_NODE_ID", "MISSING_DEPENDENCY", "SELF_DEPENDENCY", "UNKNOWN_AGENT"]));
  });

  it("detects cycles", () => {
    const result = validateFlow(
      flow([
        { id: "a", agentId: "x", dependsOn: ["c"] },
        { id: "b", agentId: "x", dependsOn: ["a"] },
        { id: "c", agentId: "x", dependsOn: ["b"] },
      ]),
    );
    expect(result.errors.map((e) => e.code)).toEqual(["CYCLE"]);
  });

  it("rejects input mappings that reference non-dependencies", () => {
    const result = validateFlow(
      flow([
        { id: "a", agentId: "x", dependsOn: [] },
        { id: "b", agentId: "x", dependsOn: [], inputMapping: { plan: "a.summary", q: "$input.prompt" } },
      ]),
    );
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].code).toBe("INVALID_INPUT_MAPPING");
  });
});

describe("topologicalLevels", () => {
  it("groups parallel nodes into the same level", () => {
    expect(topologicalLevels(codeReviewFlow)).toEqual([["plan"], ["code-review", "security-review"], ["validate"]]);
  });
});

describe("wouldCreateCycle", () => {
  it("detects back-edges and self-loops", () => {
    expect(wouldCreateCycle(codeReviewFlow, "validate", "plan")).toBe(true);
    expect(wouldCreateCycle(codeReviewFlow, "plan", "plan")).toBe(true);
    expect(wouldCreateCycle(codeReviewFlow, "plan", "validate")).toBe(false);
    expect(wouldCreateCycle(codeReviewFlow, "code-review", "security-review")).toBe(false);
  });
});
