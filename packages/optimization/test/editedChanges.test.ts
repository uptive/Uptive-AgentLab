import { describe, expect, it } from "vitest";
import type { Recommendation } from "@agentlab/contracts";
import { notTestableReason, planChanges } from "../src/changes.js";
import { codeReviewFixture } from "../src/fixtures/codeReviewRun.js";

const agent = codeReviewFixture.agents.find((a) => a.id === "code-reviewer")!;
const suggestion: Recommendation = {
  id: "quality:instructions:code-review",
  evaluatorId: "quality",
  category: "quality",
  title: "Spell out what Code Reviewer checks",
  severity: "medium",
  target: { kind: "node", nodeId: "code-review", agentId: agent.id },
  problem: "",
  suggestion: "",
  change: { type: "edit-instructions", path: "systemInstructions", before: agent.systemInstructions, after: "Check <what this step must check>." },
  estimatedImpact: { summary: "" },
};

describe("a suggested change edited by the user", () => {
  it("can't be applied while it still has placeholders", () => {
    expect(notTestableReason(codeReviewFixture, suggestion)).toMatch(/placeholder to fill in \(<what this step must check>\)/);
    expect(planChanges(codeReviewFixture, [suggestion]).edits).toEqual([]);
  });

  it("is applied with the user's value once the placeholders are filled in", () => {
    const edited = { ...suggestion, change: { ...suggestion.change, after: "Check correctness, tests and naming." } };
    expect(notTestableReason(codeReviewFixture, edited)).toBeUndefined();
    const plan = planChanges(codeReviewFixture, [edited]);
    expect(plan.edits).toMatchObject([{ field: "systemInstructions", before: agent.systemInstructions, after: "Check correctness, tests and naming." }]);
    expect(plan.agents.find((a) => a.id === agent.id)?.systemInstructions).toBe("Check correctness, tests and naming.");
  });

  it("ignores placeholders the agent's own instructions already contain", () => {
    const template = `${agent.systemInstructions}\nReview \`git -C <repoPath> diff\` and answer {"summary":"…"}.`;
    const input = { ...codeReviewFixture, agents: codeReviewFixture.agents.map((a) => (a.id === agent.id ? { ...a, systemInstructions: template } : a)) };
    const appended = { ...suggestion, change: { ...suggestion.change, before: template, after: `${template}\n\nRead only the lines you need.` } };
    expect(notTestableReason(input, appended)).toBeUndefined();
    const withNew = { ...appended, change: { ...appended.change, after: `${template}\n\nAlso check <the risky files>.` } };
    expect(notTestableReason(input, withNew)).toMatch(/<the risky files>/);
  });
});
