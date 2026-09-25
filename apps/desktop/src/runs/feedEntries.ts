import type { Run, StepRun, TraceEvent } from "@agentlab/contracts";
import { eventBlocks, type ActivityBlock, type LiveStep } from "../liveRuns.js";
import { formatMs, formatUsd, stepLatencyMs } from "./format.js";

// Everything that happened in a run as one chronological feed: steps starting and finishing, and
// what each agent thought, said and did in between. Agents still working are streamed at the end.

export type FeedTone = "neutral" | "running" | "success" | "danger";

export type FeedEntry =
  | { kind: "marker"; id: string; at?: string; stepRunId?: string; tone: FeedTone; title: string; detail?: string }
  | { kind: "activity"; id: string; at?: string; stepRunId: string; block: ActivityBlock; streaming: boolean };

const byTime = (a: TraceEvent, b: TraceEvent) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();

function stepResult(step: StepRun): string | undefined {
  const parts = [formatMs(step.usage?.latencyMs ?? stepLatencyMs(step))];
  if (step.usage) {
    parts.push(`${(step.usage.inputTokens + step.usage.outputTokens).toLocaleString()} tok`);
    parts.push(formatUsd(step.usage.estimatedCostUsd));
  }
  return parts.join(" · ");
}

function runEnd(run: Run, aborted: boolean): { tone: FeedTone; title: string } {
  if (run.status === "completed") return { tone: "success", title: "Run completed" };
  return { tone: "danger", title: aborted ? "Run stopped" : "Run failed" };
}

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
  // Steps still running with a live stream are shown token by token at the end instead.
  const streaming = new Set(
    run.steps.filter((step) => step.status === "running" && (liveSteps.get(step.id)?.blocks.length ?? 0) > 0).map((s) => s.id),
  );

  const entries: FeedEntry[] = [];
  let ended = false;
  for (const event of [...events].filter((e) => e.runId === run.id).sort(byTime)) {
    const step = event.stepRunId ? stepsById.get(event.stepRunId) : undefined;
    switch (event.type) {
      case "flow_start":
        entries.push({ kind: "marker", id: event.id, at: event.timestamp, tone: "neutral", title: "Run started" });
        break;
      case "node_start":
        entries.push({
          kind: "marker",
          id: event.id,
          at: event.timestamp,
          stepRunId: event.stepRunId,
          tone: "running",
          title: `${nameOf(event.stepRunId)} started`,
        });
        break;
      case "node_end": {
        const data = event.data as { status?: string; error?: string };
        const failed = data.status === "failed" || step?.status === "failed";
        entries.push({
          kind: "marker",
          id: event.id,
          at: event.timestamp,
          stepRunId: event.stepRunId,
          tone: failed ? "danger" : "success",
          title: `${nameOf(event.stepRunId)} ${failed ? "failed" : "finished"}`,
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
        const stepRunId = event.stepRunId;
        if (!stepRunId || streaming.has(stepRunId)) break;
        eventBlocks(event).forEach((block, index) =>
          entries.push({ kind: "activity", id: `${event.id}:${index}`, at: event.timestamp, stepRunId, block, streaming: false }),
        );
        break;
      }
      default:
        break;
    }
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

  for (const step of run.steps) {
    if (step.status !== "running") continue;
    const blocks = streaming.has(step.id) ? (liveSteps.get(step.id)?.blocks ?? []) : [];
    blocks.forEach((block, index) =>
      entries.push({
        kind: "activity",
        id: `${step.id}:live:${index}`,
        stepRunId: step.id,
        block,
        streaming: index === blocks.length - 1,
      }),
    );
  }

  if (!ended && run.status !== "running" && run.status !== "pending") {
    const cancelled = run.steps.some((step) => step.error === "Cancelled by user");
    entries.push({ kind: "marker", id: `${run.id}:end`, at: run.completedAt, ...runEnd(run, cancelled) });
  }
  return entries;
}
