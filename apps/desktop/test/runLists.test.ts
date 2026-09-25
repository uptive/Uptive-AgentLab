import { describe, expect, it } from "vitest";
import type { Run } from "@agentlab/contracts";
import { EMPTY_RUN_FILTER, RECENTLY_FINISHED_MS, countActiveRuns, filterRuns, partitionLiveRuns } from "../src/runs/runLists.js";

const NOW = Date.parse("2026-09-25T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const run = (id: string, patch: Partial<Run> = {}): Run => ({
  id,
  flowId: "flow-a",
  status: "completed",
  startedAt: ago(60_000),
  completedAt: ago(30_000),
  steps: [],
  ...patch,
});

describe("partitionLiveRuns", () => {
  it("puts running and pending runs in active, newest first", () => {
    const runs = [
      run("old", { status: "running", startedAt: ago(10_000), completedAt: undefined }),
      run("new", { status: "pending", startedAt: ago(1_000), completedAt: undefined }),
    ];
    expect(partitionLiveRuns(runs, NOW).active.map((r) => r.id)).toEqual(["new", "old"]);
  });

  it("keeps finished runs only within the recently finished window", () => {
    const runs = [
      run("fresh", { status: "failed", completedAt: ago(RECENTLY_FINISHED_MS - 1) }),
      run("stale", { completedAt: ago(RECENTLY_FINISHED_MS + 1) }),
    ];
    const { active, recentlyFinished } = partitionLiveRuns(runs, NOW);
    expect(active).toEqual([]);
    expect(recentlyFinished.map((r) => r.id)).toEqual(["fresh"]);
  });
});

describe("countActiveRuns", () => {
  it("counts running and pending runs", () => {
    expect(countActiveRuns([run("a", { status: "running" }), run("b", { status: "pending" }), run("c")])).toBe(2);
  });
});

describe("filterRuns", () => {
  const runs = [
    run("r1", { flowId: "research", status: "failed", startedAt: ago(3_000) }),
    run("r2", { flowId: "review", startedAt: ago(2_000) }),
    run("r3", { flowId: "research", startedAt: ago(1_000) }),
  ];
  const name = (r: Run) => (r.flowId === "research" ? "Research flow" : "Code review");

  it("returns everything newest first with the empty filter", () => {
    expect(filterRuns(runs, EMPTY_RUN_FILTER, name).map((r) => r.id)).toEqual(["r3", "r2", "r1"]);
  });

  it("combines status, flow and query filters", () => {
    expect(filterRuns(runs, { status: "completed", flowId: "research", query: "" }, name).map((r) => r.id)).toEqual(["r3"]);
    expect(filterRuns(runs, { ...EMPTY_RUN_FILTER, query: "  REVIEW " }, name).map((r) => r.id)).toEqual(["r2"]);
    expect(filterRuns(runs, { ...EMPTY_RUN_FILTER, query: "r1" }, name).map((r) => r.id)).toEqual(["r1"]);
  });
});
