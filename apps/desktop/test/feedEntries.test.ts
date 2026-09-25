import { describe, expect, it } from "vitest";
import type { Run, StepRun, TraceEvent } from "@agentlab/contracts";
import type { LiveStep } from "../src/liveRuns.js";
import { buildLiveStatus, buildRunFeed, type FeedEntry } from "../src/runs/feedEntries.js";

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
  entries.map((e) =>
    e.kind === "marker" ? `${e.tone}:${e.title}` : e.kind === "stat" ? "stat" : `${e.block.kind}${e.streaming ? "*" : ""}`,
  );
const at = (second: number) => `2026-09-25T12:00:${String(second).padStart(2, "0")}Z`;

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
      "stat",
      "tool_use",
      "success:Agent a finished",
    ]);
  });

  it("adds the model and tools to the start line instead of a second line", () => {
    const events = [
      event("node_start", 1, {}, "a"),
      event("agent_start", 1, { model: "claude-sonnet-5", tools: ["Read", "mcp__github__list_issues"] }, "a"),
    ];
    const feed = buildRunFeed(run([step("a", { status: "running" })]), events, new Map(), name);
    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({ title: "Agent a started", detail: "claude-sonnet-5 · tools: Read, github · list issues" });
  });

  it("drops a block repeated with the same text", () => {
    const events = [event("model_call", 1, { text: "Same" }, "a"), event("model_call", 2, { text: " Same " }, "a")];
    const feed = buildRunFeed(run([step("a")]), events, new Map(), name);
    expect(summary(feed)).toEqual(["text", "stat", "stat"]);
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

  it("interleaves a running step's live blocks by time and fills in tool results", () => {
    const live: LiveStep = {
      blocks: [
        { kind: "thinking", text: "plan", at: at(2) },
        { kind: "tool_use", text: "", toolName: "Read", toolUseId: "t1", at: at(3) },
        { kind: "text", text: "writing", at: at(6) },
      ],
    };
    const events = [
      event("node_start", 1, {}, "a"),
      event("model_call", 4, { thinking: "plan" }, "a"),
      event("tool_call", 5, { toolId: "Read", toolUseId: "t1", input: { file_path: "x" }, output: "ok", durationMs: 12 }, "a"),
    ];
    const feed = buildRunFeed(run([step("a", { status: "running" })]), events, new Map([["a", live]]), name);
    expect(summary(feed)).toEqual(["running:Agent a started", "thinking", "tool_use", "stat", "text*"]);
    const tool = feed.find((e) => e.kind === "activity" && e.block.kind === "tool_use");
    expect(tool).toMatchObject({ block: { output: "ok", durationMs: 12, input: { file_path: "x" } } });
  });

  it("ignores other runs' events and hides the structured-output tool", () => {
    const events = [
      { ...event("flow_start", 0, {}), runId: "other" },
      event("tool_call", 1, { toolId: "StructuredOutput", input: {}, output: {} }, "a"),
    ];
    expect(buildRunFeed(run([step("a")]), events, new Map(), name)).toEqual([]);
  });
});

describe("buildLiveStatus", () => {
  const flow = {
    id: "flow",
    name: "Flow",
    nodes: [
      { id: "a", agentId: "agent-a", dependsOn: [] },
      { id: "b", agentId: "agent-b", dependsOn: ["a"] },
    ],
  };

  it("says what running agents do and what waiting agents wait for", () => {
    const r = run([
      step("a", { status: "running", startedAt: at(0) }),
      step("b", { status: "pending" }),
    ]);
    const live: LiveStep = { blocks: [{ kind: "tool_use", text: "", toolName: "Bash" }], inputTokens: 1000, outputTokens: 200 };
    const lines = buildLiveStatus(r, flow, new Map([["a", live]]), name, Date.parse(at(3)));
    expect(lines.map((l) => l.text)).toEqual([
      "Agent a is using run command · 3.0s · 1,200 tokens so far",
      "Agent b waits for Agent a",
    ]);
  });

  it("is empty once the run has finished", () => {
    expect(buildLiveStatus(run([step("a")], { status: "completed" }), flow, new Map(), name, 0)).toEqual([]);
  });
});
