import { describe, expect, it } from "vitest";
import type { Run, StepRun } from "@agentlab/contracts";
import { interruptRun } from "../src/index.js";

const AT = "2026-09-25T12:00:00.000Z";

const step = (id: string, fields: Partial<StepRun>): StepRun => ({
  id,
  runId: "run-1",
  nodeId: id,
  agentId: id,
  status: "pending",
  input: {},
  toolCalls: [],
  ...fields,
});

const openRun = (steps: StepRun[]): Run => ({
  id: "run-1",
  flowId: "flow-1",
  status: "running",
  startedAt: "2026-09-25T11:00:00.000Z",
  steps,
});

describe("interruptRun", () => {
  it("fails the run and every open step with the reason", () => {
    const run = interruptRun(openRun([step("a", { status: "running" }), step("b", { status: "pending" })]), "Interrupted", AT);

    expect(run.status).toBe("failed");
    expect(run.completedAt).toBe(AT);
    for (const s of run.steps) expect(s).toMatchObject({ status: "failed", completedAt: AT, error: "Interrupted" });
  });

  it("leaves finished steps and their outputs unchanged", () => {
    const done = step("a", { status: "completed", output: { text: "hi" }, completedAt: "2026-09-25T11:30:00.000Z" });
    const failed = step("b", { status: "failed", error: "Boom", completedAt: "2026-09-25T11:31:00.000Z" });

    const run = interruptRun(openRun([done, failed, step("c", { status: "pending" })]), "Interrupted", AT);

    expect(run.steps[0]).toEqual(done);
    expect(run.steps[1]).toEqual(failed);
    expect(run.steps[2].status).toBe("failed");
  });

  it("keeps an existing completedAt and error on an open step and on the run", () => {
    const running = step("a", { status: "running", completedAt: "2026-09-25T11:45:00.000Z", error: "Token limit" });
    const run = interruptRun({ ...openRun([running]), completedAt: "2026-09-25T11:50:00.000Z" }, "Interrupted", AT);

    expect(run.completedAt).toBe("2026-09-25T11:50:00.000Z");
    expect(run.steps[0]).toMatchObject({ status: "failed", completedAt: "2026-09-25T11:45:00.000Z", error: "Token limit" });
  });

  it("does not mutate the input run", () => {
    const input = openRun([step("a", { status: "running" })]);
    const copy = structuredClone(input);
    interruptRun(input, "Interrupted", AT);
    expect(input).toEqual(copy);
  });
});
