import { describe, expect, it } from "vitest";
import type { AgentDefinition, StepRun } from "@agentlab/contracts";
import { analyzeRun } from "../analyzeRun.js";
import { codeReviewFixture } from "../fixtures/codeReviewRun.js";
import type { EvaluationInput } from "../types.js";
import { jevSubstitutionEvaluator } from "./jevSubstitution.js";

const GATE_SCHEMA = {
  type: "object",
  required: ["verdict", "blocking", "confidence"],
  properties: {
    verdict: { enum: ["approve", "block"] },
    blocking: { type: "boolean" },
    confidence: { type: "number" },
  },
};

/** The fixture's validator step, rewritten into whatever shape a test needs. */
function withValidator(agent: Partial<AgentDefinition>, step: Partial<StepRun> = {}): EvaluationInput {
  const agents = codeReviewFixture.agents.map((a) => (a.id === "final-validator" ? ({ ...a, ...agent } as AgentDefinition) : a));
  const steps = codeReviewFixture.run.steps.map((s) => (s.nodeId === "validate" ? { ...s, ...step } : s));
  return { ...codeReviewFixture, agents, run: { ...codeReviewFixture.run, steps }, capabilities: { jevAvailable: true } };
}

const gateRun = () => withValidator({ model: "claude-opus-5-5", outputSchema: GATE_SCHEMA });

describe("Jev Substitution evaluator", () => {
  it("recommends Jev for a strong-model step that only produces a typed verdict", async () => {
    const recs = await jevSubstitutionEvaluator.evaluate(gateRun());
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({
      id: "jev-substitution:validate",
      evaluatorId: "jev-substitution",
      category: "model-selection",
      target: { kind: "node", nodeId: "validate", agentId: "final-validator" },
      change: { type: "set-engine", path: "engine", before: "claude", after: "jev" },
    });
    expect(recs[0].evidence?.[0]).toContain("verdict, blocking, confidence");
    expect(recs[0].evidence?.[1]).toContain("610 tokens");
  });

  it("costs the change against the Jev input price", async () => {
    const [rec] = await jevSubstitutionEvaluator.evaluate(gateRun());
    // 7,400 input + 610 output on claude-opus-5-5 vs 7,400 input tokens at $0.042/MTok.
    expect(rec.estimatedImpact.cost!.usdPerRun).toBeLessThan(0);
    expect(rec.estimatedImpact.cost!.percent).toBe(-90);
    expect(rec.evidence?.at(-2)).toMatch(/on Jev ≈ \$0\.0003/);
  });

  it("emits nothing when Jev is not available on this computer", async () => {
    const input = { ...gateRun(), capabilities: undefined };
    expect(jevSubstitutionEvaluator.skipReason!(input)).toMatch(/not configured/);
    const result = await analyzeRun(input, [jevSubstitutionEvaluator]);
    expect(result.recommendations).toEqual([]);
    expect(result.skippedEvaluators).toEqual([
      { evaluatorId: "jev-substitution", category: "model-selection", reason: "TypeSafe Jev is not configured on this computer" },
    ]);
  });

  it("reports the skip through analyzeRun's progress", async () => {
    const updates: string[] = [];
    await analyzeRun({ ...gateRun(), capabilities: { jevAvailable: false } }, [jevSubstitutionEvaluator], {
      onProgress: (p) => updates.push(p.status),
    });
    expect(updates).toEqual(["running", "skipped"]);
  });

  it("rejects a step that writes files", async () => {
    const input = withValidator(
      { model: "claude-opus-5-5", outputSchema: GATE_SCHEMA },
      { toolCalls: [{ toolId: "Edit", input: {}, output: {}, startedAt: "", completedAt: "" }] },
    );
    expect(await jevSubstitutionEvaluator.evaluate(input)).toEqual([]);
  });

  it("rejects a step whose output is mostly written text", async () => {
    const input = withValidator({
      model: "claude-opus-5-5",
      outputSchema: {
        type: "object",
        properties: { verdict: { enum: ["approve", "block"] }, summary: { type: "string" }, notes: { type: "array", items: { type: "string" } } },
      },
    });
    expect(await jevSubstitutionEvaluator.evaluate(input)).toEqual([]);
  });

  it("rejects a schema without a choice or yes/no field", async () => {
    const input = withValidator({
      model: "claude-opus-5-5",
      outputSchema: { type: "object", properties: { score: { type: "number" }, weight: { type: "number" } } },
    });
    expect(await jevSubstitutionEvaluator.evaluate(input)).toEqual([]);
  });

  it("rejects a long output, even with a decision-shaped schema", async () => {
    const step = codeReviewFixture.run.steps.find((s) => s.nodeId === "validate")!;
    const input = withValidator(
      { model: "claude-opus-5-5", outputSchema: GATE_SCHEMA },
      { usage: { ...step.usage!, outputTokens: 4_200 } },
    );
    expect(await jevSubstitutionEvaluator.evaluate(input)).toEqual([]);
  });

  it("leaves steps on cheaper models and steps without an output schema alone", async () => {
    expect(await jevSubstitutionEvaluator.evaluate(withValidator({ outputSchema: GATE_SCHEMA }))).toEqual([]);
    expect(await jevSubstitutionEvaluator.evaluate(withValidator({ model: "claude-opus-5-5", outputSchema: undefined }))).toEqual([]);
  });

  it("never recommends replacing an agent that already runs on Jev", async () => {
    const input = { ...codeReviewFixture, capabilities: { jevAvailable: true } };
    const jevAgents = input.agents.filter((a) => a.engine === "jev").map((a) => a.id);
    const recs = await jevSubstitutionEvaluator.evaluate(input);
    expect(recs.filter((r) => r.target.kind === "node" && jevAgents.includes(r.target.agentId))).toEqual([]);
  });
});
