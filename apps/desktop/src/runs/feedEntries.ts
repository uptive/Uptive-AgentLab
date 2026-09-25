import type { FlowDefinition, Run, StepRun, TraceEvent } from "@agentlab/contracts";
import { buildActivity, eventBlocks, type ActivityBlock, type LiveStep } from "../liveRuns.js";
import { formatMs, formatUsd, stepLatencyMs } from "./format.js";
import { summarizeToolCall, toolDisplayName } from "./toolSummary.js";

// Everything that happened in a run as one chronological feed: steps starting and finishing, each
// model call, and what every agent thought, said and did. Running agents stream in token by token.

export type FeedTone = "neutral" | "running" | "success" | "danger";

export type FeedEntry =
  | { kind: "marker"; id: string; at?: string; stepRunId?: string; tone: FeedTone; title: string; detail?: string }
  /** A small line of numbers, e.g. the tokens of one model call. */
  | { kind: "stat"; id: string; at?: string; stepRunId: string; text: string }
  | { kind: "activity"; id: string; at?: string; stepRunId: string; block: ActivityBlock; streaming: boolean };

/** What an agent is doing right now, shown under the feed while the run is live. */
export interface LiveStatus {
  stepRunId: string;
  tone: FeedTone;
  text: string;
}

const time = (iso: string | undefined) => (iso ? new Date(iso).getTime() : Number.POSITIVE_INFINITY);

function stepResult(step: StepRun): string {
  const parts = [formatMs(step.usage?.latencyMs ?? stepLatencyMs(step))];
  if (step.usage) {
    parts.push(`${(step.usage.inputTokens + step.usage.outputTokens).toLocaleString()} tokens`);
    parts.push(formatUsd(step.usage.estimatedCostUsd));
  }
  return parts.join(" · ");
}

function runEnd(run: Run, aborted: boolean): { tone: FeedTone; title: string } {
  if (run.status === "completed") return { tone: "success", title: "Run completed" };
  return { tone: "danger", title: aborted ? "Run stopped" : "Run failed" };
}

function describeAgentStart(data: unknown): string | undefined {
  const { model, tools, skills } = (data ?? {}) as { model?: string; tools?: unknown; skills?: unknown };
  const list = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);
  const parts = [
    model,
    list(tools).length ? `tools: ${list(tools).map(toolDisplayName).join(", ")}` : undefined,
    list(skills).length ? `skills: ${list(skills).join(", ")}` : undefined,
  ];
  const detail = parts.filter(Boolean).join(" · ");
  return detail || undefined;
}

const STOP_REASONS: Record<string, string> = {
  end_turn: "done talking",
  tool_use: "calling a tool",
  max_tokens: "hit the output limit",
  stop_sequence: "stopped",
  pause_turn: "paused",
  refusal: "refused",
};

function describeModelCall(data: unknown): string {
  const d = (data ?? {}) as { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; stopReason?: string | null };
  const parts = [`Model call · ${(d.inputTokens ?? 0).toLocaleString()} in · ${(d.outputTokens ?? 0).toLocaleString()} out tokens`];
  if (d.cacheReadTokens) parts.push(`${d.cacheReadTokens.toLocaleString()} from cache`);
  if (d.stopReason) parts.push(STOP_REASONS[d.stopReason] ?? d.stopReason);
  return parts.join(" · ");
}

/** Same step, same kind, same text: a block repeated by the stream or the trace. */
const isRepeat = (a: FeedEntry | undefined, b: FeedEntry) =>
  a?.kind === "activity" &&
  b.kind === "activity" &&
  a.block.kind === b.block.kind &&
  b.block.kind !== "tool_use" &&
  a.block.text.trim() === b.block.text.trim();

export function buildRunFeed(
  run: Run,
  events: readonly TraceEvent[],
  liveSteps: ReadonlyMap<string, LiveStep>,
  agentName: (agentId: string) => string,
): FeedEntry[] {
  const stepsById = new Map(run.steps.map((step) => [step.id, step]));
  const nameOf = (stepRunId: string | undefined) => {
    const step = stepRunId ? stepsById.get(stepRunId) : undefined;
    return step ? agentName(step.agentId) : "An agent";
  };
  const runEvents = events.filter((e) => e.runId === run.id);
  // Running steps with a live stream show it token by token instead of their recorded blocks.
  const streaming = new Set(
    run.steps.filter((step) => step.status === "running" && (liveSteps.get(step.id)?.blocks.length ?? 0) > 0).map((s) => s.id),
  );

  const entries: FeedEntry[] = [];
  const startMarkers = new Map<string, Extract<FeedEntry, { kind: "marker" }>>();
  let ended = false;
  for (const event of runEvents) {
    const stepRunId = event.stepRunId;
    const step = stepRunId ? stepsById.get(stepRunId) : undefined;
    switch (event.type) {
      case "flow_start":
        entries.push({ kind: "marker", id: event.id, at: event.timestamp, tone: "neutral", title: "Run started" });
        break;
      case "node_start": {
        const marker = { kind: "marker" as const, id: event.id, at: event.timestamp, stepRunId, tone: "running" as const, title: `${nameOf(stepRunId)} started` };
        entries.push(marker);
        if (stepRunId) startMarkers.set(stepRunId, marker);
        break;
      }
      case "agent_start": {
        // Same moment as node_start; add the model and tools to that line instead of repeating it.
        const marker = stepRunId ? startMarkers.get(stepRunId) : undefined;
        if (marker) marker.detail = describeAgentStart(event.data);
        break;
      }
      case "node_end": {
        const data = event.data as { status?: string; error?: string };
        const failed = data.status === "failed" || step?.status === "failed";
        entries.push({
          kind: "marker",
          id: event.id,
          at: event.timestamp,
          stepRunId,
          tone: failed ? "danger" : "success",
          title: `${nameOf(stepRunId)} ${failed ? "failed" : "finished"}`,
          detail: failed ? (data.error ?? step?.error) : step ? stepResult(step) : undefined,
        });
        break;
      }
      case "flow_end": {
        ended = true;
        const aborted = Boolean((event.data as { aborted?: boolean }).aborted);
        entries.push({ kind: "marker", id: event.id, at: event.timestamp, ...runEnd(run, aborted) });
        break;
      }
      case "model_call":
      case "tool_call": {
        if (!stepRunId) break;
        if (!streaming.has(stepRunId)) {
          eventBlocks(event).forEach((block, index) =>
            entries.push({ kind: "activity", id: `${event.id}:${index}`, at: block.at, stepRunId, block, streaming: false }),
          );
        }
        if (event.type === "model_call") {
          entries.push({ kind: "stat", id: `${event.id}:stat`, at: event.timestamp, stepRunId, text: describeModelCall(event.data) });
        }
        break;
      }
      default:
        break;
    }
  }

  // Live blocks, with tool results and durations filled in from the trace as they arrive.
  for (const stepRunId of streaming) {
    buildActivity(stepRunId, runEvents, liveSteps.get(stepRunId)).forEach((block, index) =>
      entries.push({ kind: "activity", id: `${stepRunId}:live:${index}`, at: block.at, stepRunId, block, streaming: false }),
    );
  }

  // Steps that were stopped or failed without a node_end event (e.g. cancelled by the user).
  for (const step of run.steps) {
    if (step.status !== "failed" || entries.some((e) => e.kind === "marker" && e.stepRunId === step.id && e.tone === "danger")) continue;
    entries.push({
      kind: "marker",
      id: `${step.id}:failed`,
      at: step.completedAt,
      stepRunId: step.id,
      tone: "danger",
      title: `${agentName(step.agentId)} failed`,
      detail: step.error,
    });
  }

  if (!ended && run.status !== "running" && run.status !== "pending") {
    const cancelled = run.steps.some((step) => step.error === "Cancelled by user");
    entries.push({ kind: "marker", id: `${run.id}:end`, at: run.completedAt, ...runEnd(run, cancelled) });
  }

  // Stable sort by time: entries sharing a timestamp keep the order they were added in.
  const sorted = entries.map((entry, index) => ({ entry, index })).sort((a, b) => time(a.entry.at) - time(b.entry.at) || a.index - b.index);

  const feed: FeedEntry[] = [];
  const lastActivity = new Map<string, FeedEntry>();
  for (const { entry } of sorted) {
    if (entry.kind === "activity") {
      if (isRepeat(lastActivity.get(entry.stepRunId), entry)) continue;
      lastActivity.set(entry.stepRunId, entry);
    }
    feed.push(entry);
  }
  // The newest block of each streaming step is the one growing token by token.
  for (const stepRunId of streaming) {
    const last = lastActivity.get(stepRunId);
    if (last?.kind === "activity") feed[feed.indexOf(last)] = { ...last, streaming: true };
  }
  return feed;
}

/** One line per agent that is working or waiting, e.g. "Research is using Read file · 12.3s · 4,210 tokens". */
export function buildLiveStatus(
  run: Run,
  flow: FlowDefinition,
  liveSteps: ReadonlyMap<string, LiveStep>,
  agentName: (agentId: string) => string,
  now: number,
): LiveStatus[] {
  if (run.status !== "running") return [];
  const stepByNode = new Map(run.steps.map((step) => [step.nodeId, step]));
  const statuses: LiveStatus[] = [];
  for (const node of flow.nodes) {
    const step = stepByNode.get(node.id);
    if (!step) continue;
    const name = node.label ?? agentName(node.agentId);
    if (step.status === "running") {
      const live = liveSteps.get(step.id);
      const last = live?.blocks[live.blocks.length - 1];
      const doing =
        last?.kind === "tool_use" && last.output === undefined
          ? `is using ${summarizeToolCall(last.toolName, last.input).title.toLowerCase()}`
          : last?.kind === "thinking"
            ? "is thinking"
            : last?.kind === "text"
              ? "is writing"
              : "is starting";
      const tokens = (live?.inputTokens ?? 0) + (live?.outputTokens ?? 0);
      const parts = [`${name} ${doing}`, formatMs(stepLatencyMs(step, now))];
      if (tokens > 0) parts.push(`${tokens.toLocaleString()} tokens so far`);
      statuses.push({ stepRunId: step.id, tone: "running", text: parts.join(" · ") });
    } else if (step.status === "pending") {
      const waitingFor = node.dependsOn
        .filter((dep) => stepByNode.get(dep)?.status !== "completed")
        .map((dep) => {
          const depNode = flow.nodes.find((n) => n.id === dep);
          return depNode ? (depNode.label ?? agentName(depNode.agentId)) : dep;
        });
      statuses.push({
        stepRunId: step.id,
        tone: "neutral",
        text: waitingFor.length ? `${name} waits for ${waitingFor.join(", ")}` : `${name} is queued`,
      });
    }
  }
  return statuses;
}
