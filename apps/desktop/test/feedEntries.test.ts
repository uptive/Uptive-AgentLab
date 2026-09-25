import { describe, expect, it } from "vitest";
import type { Run, StepRun, TraceEvent } from "@agentlab/contracts";
import type { LiveStep } from "../src/liveRuns.js";
import { buildRunFeed, type FeedEntry } from "../src/runs/feedEntries.js";

const step = (id: string, patch: Partial<StepRun> = {}): StepRun => ({
  id,
  runId: "run-1",
  nodeId: id,
  agentId: `agent-${id}`,
  status: "completed",
  input: undefined,
  toolCalls: [],
  ...patch,
});

const run = (steps: StepRun[], patch: Partial<Run> = {}): Run => ({
  id: "run-1",
  flowId: "flow",
  status: "running",
  startedAt: "2026-09-25T12:00:00Z",
  steps,
  ...patch,
});

let seq = 0;
const event = (type: TraceEvent["type"], second: number, data: unknown, stepRunId?: string): TraceEvent => ({
  id: `e${seq++}`,
  runId: "run-1",
  stepRunId,
  type,
  timestamp: `2026-09-25T12:00:${String(second).padStart(2, "0")}Z`,
  data,
});

const name = (agentId: string) => agentId.replace("agent-", "Agent ");
const summary = (entries: FeedEntry[]) =>
  entries.map((e) => (e.kind === "marker" ? `${e.tone}:${e.title}` : `${e.block.kind}${e.streaming ? "*" : ""}`));

describe("buildRunFeed", () => {
  it("orders recorded events by time across steps", () => {
    const events = [
      event("node_end", 5, { status: "completed" }, "a"),
      event("flow_start", 0, {}),
      event("tool_call", 3, { toolId: "Read", input: { file_path: "x" }, output: "ok" }, "a"),
      event("node_start", 1, {}, "a"),
      event("model_call", 2, { thinking: "hmm", text: "Reading" }, "a"),
    ];
    expect(summary(buildRunFeed(run([step("a")]), events, new Map(), name))).toEqual([
      "neutral:Run started",
      "running:Agent a started",
      "thinking",
      "text",
      "tool_use",
      "success:Agent a finished",
    ]);
  });

  it("marks failed steps red and adds the error", () => {
    const events = [event("node_end", 1, { status: "failed", error: "boom" }, "a")];
    const [entry] = buildRunFeed(run([step("a", { status: "failed" })]), events, new Map(), name);
    expect(entry).toMatchObject({ kind: "marker", tone: "danger", title: "Agent a failed", detail: "boom" });
  });

  it("adds a red entry for steps that failed without a node_end, e.g. cancelled", () => {
    const r = run([step("a", { status: "failed", error: "Cancelled by user" })], { status: "failed" });
    expect(summary(buildRunFeed(r, [], new Map(), name))).toEqual(["danger:Agent a failed", "danger:Run stopped"]);
  });

  it("streams a running step's live blocks instead of its recorded events", () => {
    const live: LiveStep = { blocks: [{ kind: "thinking", text: "a" }, { kind: "text", text: "b" }] };
    const events = [event("node_start", 1, {}, "a"), event("model_call", 2, { text: "old" }, "a")];
    const feed = buildRunFeed(run([step("a", { status: "running" })]), events, new Map([["a", live]]), name);
    expect(summary(feed)).toEqual(["running:Agent a started", "thinking", "text*"]);
  });

  it("ignores other runs' events and hides the structured-output tool", () => {
    const events = [
      { ...event("flow_start", 0, {}), runId: "other" },
      event("tool_call", 1, { toolId: "StructuredOutput", input: {}, output: {} }, "a"),
    ];
    expect(buildRunFeed(run([step("a")]), events, new Map(), name)).toEqual([]);
  });
});
