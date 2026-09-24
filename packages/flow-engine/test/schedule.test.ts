import { describe, expect, it } from "vitest";
import { computeSchedule, hashedDuration } from "../src/index.js";
import { codeReviewFlow } from "./fixtures/codeReviewFlow.js";

describe("computeSchedule", () => {
  const durations: Record<string, number> = { plan: 100, "code-review": 300, "security-review": 100, validate: 50 };
  const schedule = computeSchedule(codeReviewFlow, { durationOf: (id) => durations[id], handoffMs: 10 });

  it("runs sequential steps after their dependency hands off", () => {
    expect(schedule.nodes.plan).toEqual({ firstInputAt: 0, start: 0, end: 100 });
    expect(schedule.nodes["code-review"].start).toBe(110);
  });

  it("overlaps parallel steps", () => {
    expect(schedule.nodes["security-review"]).toEqual({ firstInputAt: 110, start: 110, end: 210 });
  });

  it("joins on the slowest dependency", () => {
    // code-review ends 410, security-review ends 210 -> arrivals 420 / 220.
    expect(schedule.nodes.validate).toEqual({ firstInputAt: 220, start: 420, end: 470 });
    expect(schedule.totalDuration).toBe(470);
  });

  it("produces one edge per dependency", () => {
    expect(schedule.edges).toHaveLength(4);
    expect(schedule.edges.find((e) => e.source === "security-review")).toEqual({
      source: "security-review",
      target: "validate",
      start: 210,
      end: 220,
    });
  });

  it("hashedDuration is deterministic and in range", () => {
    expect(hashedDuration("abc")).toBe(hashedDuration("abc"));
    for (const k of ["a", "b", "planner", "x-2"]) {
      expect(hashedDuration(k, 10, 20)).toBeGreaterThanOrEqual(10);
      expect(hashedDuration(k, 10, 20)).toBeLessThanOrEqual(20);
    }
  });
});
