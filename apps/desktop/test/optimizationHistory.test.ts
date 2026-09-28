import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { codeReviewFixture } from "@agentlab/optimization";
import { RECENT_OPTIMIZATIONS, SavedOptimizationSchema, createOptimizationHistory } from "../electron/optimizationHistory.js";
import { toSavedOptimization } from "../src/optimize/history.js";

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "agentlab-optimizations-"));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

/** A saved optimization of the fixture run, created `minute` minutes into the hour. */
function record(id: string, minute = 0, appliedKeys: string[] = []) {
  return SavedOptimizationSchema.parse(
    toSavedOptimization({
      id,
      createdAt: new Date(Date.UTC(2026, 8, 28, 10, minute)).toISOString(),
      input: codeReviewFixture,
      analyses: [{ modelId: "claude-sonnet-5", calls: [], durationMs: 1200 }],
      analyzedWith: "claude-sonnet-5",
      appliedKeys,
      edits: new Map([["claude-sonnet-5::quality:x", "New instructions"]]),
    }),
  );
}

describe("optimization history", () => {
  it("lists nothing before anything is saved", async () => {
    expect(await createOptimizationHistory(dir).listRecent()).toEqual({ items: [], unreadable: [] });
  });

  it("saves an optimization without its trace events and reopens it", async () => {
    const history = createOptimizationHistory(dir);
    await history.save(record("opt_a"));
    const reopened = await history.get("opt_a");
    expect(reopened?.summary).toMatchObject({ id: "opt_a", flowName: codeReviewFixture.flow.name, modelIds: ["claude-sonnet-5"] });
    expect(reopened?.input.events).toBeUndefined();
    expect(reopened?.edits).toEqual([["claude-sonnet-5::quality:x", "New instructions"]]);
  });

  it("replaces an optimization saved again, e.g. after applying a change", async () => {
    const history = createOptimizationHistory(dir);
    await history.save(record("opt_a"));
    await history.save(record("opt_a", 0, ["claude-sonnet-5::quality:x"]));
    const { items } = await history.listRecent();
    expect(items).toHaveLength(1);
    expect(items[0].applied).toBe(1);
  });

  it(`lists the ${RECENT_OPTIMIZATIONS} newest, newest first`, async () => {
    const history = createOptimizationHistory(dir);
    for (let minute = 0; minute < RECENT_OPTIMIZATIONS + 3; minute++) await history.save(record(`opt_${minute}`, minute));
    const { items } = await history.listRecent();
    expect(items).toHaveLength(RECENT_OPTIMIZATIONS);
    expect(items[0].id).toBe(`opt_${RECENT_OPTIMIZATIONS + 2}`);
  });

  it("reports an unreadable file instead of hiding the others", async () => {
    const history = createOptimizationHistory(dir);
    await history.save(record("opt_good", 0));
    await fs.writeFile(path.join(dir, "2026-09-28T11-00-00-000Z_opt_broken.json"), "{ not json");
    const { items, unreadable } = await history.listRecent();
    expect(items.map((o) => o.id)).toEqual(["opt_good"]);
    expect(unreadable).toHaveLength(1);
  });

  it("rejects ids that aren't safe file names", () => {
    expect(SavedOptimizationSchema.safeParse(record("opt_a")).success).toBe(true);
    const unsafe = { ...record("opt_a"), summary: { ...record("opt_a").summary, id: "../../secrets" } };
    expect(SavedOptimizationSchema.safeParse(unsafe).success).toBe(false);
  });
});
