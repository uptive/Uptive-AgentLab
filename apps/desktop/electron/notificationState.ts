import type { Run } from "@agentlab/contracts";
import type { NotificationSettings } from "./notificationSettings.js";

// Pure decisions behind notifications: what to say, when to say it, and how far runs have come.
// Kept free of Electron so it can be unit tested. The wording follows the design for background
// notifications: the title is the flow name plus what happened (the OS already shows the app name),
// and the body carries the figures from the run summary.

export type RunOutcome = "completed" | "failed" | "cancelled";

/** A finished Optimize analysis, as reported by the renderer. */
export interface OptimizationSummary {
  flowName: string;
  recommendations: number;
  highSeverity: number;
  /** Estimated cost saved per run if every recommendation is applied. */
  savedUsdPerRun: number;
}

export type NotifyEvent = { kind: "run"; run: Run; outcome: RunOutcome } | ({ kind: "optimization" } & OptimizationSummary);

export interface NotificationMessage {
  title: string;
  body: string;
}

/** Three or more events this close together collapse into one digest notification. */
export const DIGEST_WINDOW_MS = 10_000;
export const DIGEST_MIN_EVENTS = 3;

export function runName(run: Run): string {
  return run.flow?.name ?? run.flowId;
}

/** How a finished run ended. Aborted runs count as cancelled whatever status the engine reported. */
export function outcomeOf(run: Run, aborted: boolean): RunOutcome {
  if (aborted) return "cancelled";
  return run.status === "completed" ? "completed" : "failed";
}

export function durationMs(run: Run, now: Date = new Date()): number {
  const end = run.completedAt ? Date.parse(run.completedAt) : now.getTime();
  return Math.max(0, end - Date.parse(run.startedAt));
}

export function formatDuration(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export const formatUsd = (usd: number) => `$${usd.toFixed(4)}`;

const formatTokens = (tokens: number) => `${tokens.toLocaleString("en-US")} tok`;

function runTokens(run: Run): number {
  const usage = run.totalUsage;
  if (usage) return usage.inputTokens + usage.outputTokens;
  return run.steps.reduce((sum, s) => sum + (s.usage ? s.usage.inputTokens + s.usage.outputTokens : 0), 0);
}

function runCost(run: Run): number {
  return run.totalUsage?.estimatedCostUsd ?? run.steps.reduce((sum, s) => sum + (s.usage?.estimatedCostUsd ?? 0), 0);
}

const doneSteps = (run: Run) => run.steps.filter((s) => s.status === "completed" || s.status === "failed").length;
const completedSteps = (run: Run) => run.steps.filter((s) => s.status === "completed").length;

export function stepSummary(run: Run): string {
  return `${doneSteps(run)}/${run.steps.length} steps`;
}

/** The node label, else the agent's name, else its id. */
function stepLabel(run: Run, nodeId: string, agentId: string): string {
  return run.flow?.nodes.find((n) => n.id === nodeId)?.label ?? run.agents?.find((a) => a.id === agentId)?.name ?? agentId;
}

const MAX_ERROR_LENGTH = 140;

function firstFailure(run: Run): string | undefined {
  const index = run.steps.findIndex((s) => s.status === "failed");
  if (index < 0) return undefined;
  const step = run.steps[index];
  const error = step.error ?? "failed";
  const reason = error.length > MAX_ERROR_LENGTH ? `${error.slice(0, MAX_ERROR_LENGTH - 1)}…` : error;
  return `Step ${index + 1} of ${run.steps.length}, ${stepLabel(run, step.nodeId, step.agentId)}: ${reason}`;
}

export function describeRun(run: Run, outcome: RunOutcome, now: Date = new Date()): NotificationMessage {
  const name = runName(run);
  const duration = formatDuration(durationMs(run, now));
  const figures = [`${completedSteps(run)} of ${run.steps.length} steps completed`, duration, formatTokens(runTokens(run)), formatUsd(runCost(run))].join(" · ");
  if (outcome === "completed") return { title: `${name} finished`, body: figures };
  if (outcome === "cancelled") return { title: `${name} was stopped`, body: figures };
  const failure = firstFailure(run);
  return { title: `${name} failed`, body: failure ? `${failure} after ${duration}` : `Failed after ${duration}` };
}

export function describeOptimization(summary: OptimizationSummary): NotificationMessage {
  const count = `${summary.recommendations} ${summary.recommendations === 1 ? "recommendation" : "recommendations"}`;
  const parts = [summary.highSeverity > 0 ? `${count}, ${summary.highSeverity} high severity` : count];
  if (summary.savedUsdPerRun > 0) parts.push(`est. ${formatUsd(summary.savedUsdPerRun)} saved per run`);
  return { title: `Optimize reviewed ${summary.flowName}`, body: parts.join(" · ") };
}

export function describeEvent(event: NotifyEvent, now: Date = new Date()): NotificationMessage {
  return event.kind === "run" ? describeRun(event.run, event.outcome, now) : describeOptimization(event);
}

/** One notification for a burst of events, e.g. "3 runs finished — 2 completed, 1 failed · 24.7s total · $0.0414". */
export function describeDigest(events: NotifyEvent[], now: Date = new Date()): NotificationMessage {
  const runs = events.flatMap((e) => (e.kind === "run" ? [e] : []));
  const optimizations = events.length - runs.length;
  const count = (outcome: RunOutcome) => runs.filter((e) => e.outcome === outcome).length;
  const tally = [
    [count("completed"), "completed"],
    [count("failed"), "failed"],
    [count("cancelled"), "stopped"],
    [optimizations, optimizations === 1 ? "optimization" : "optimizations"],
  ]
    .filter(([n]) => n)
    .map(([n, label]) => `${n} ${label}`)
    .join(", ");
  const parts = [tally];
  if (runs.length > 0) {
    parts.push(`${formatDuration(runs.reduce((sum, e) => sum + durationMs(e.run, now), 0))} total`);
    parts.push(formatUsd(runs.reduce((sum, e) => sum + runCost(e.run), 0)));
  }
  const title = optimizations === 0 ? `${runs.length} runs finished` : `${events.length} updates`;
  return { title, body: parts.join(" · ") };
}

export function wantsNotification(settings: NotificationSettings, event: NotifyEvent): boolean {
  if (event.kind === "optimization") return settings.optimizationFinished;
  if (event.outcome === "completed") return settings.runCompleted;
  if (event.outcome === "failed") return settings.runFailed;
  return settings.runCancelled;
}

/** Webhooks are for long runs only, and never for runs the user stopped themselves. */
export function wantsWebhook(settings: NotificationSettings, outcome: RunOutcome, runMs: number): boolean {
  const { webhook } = settings;
  if (!webhook.enabled || outcome === "cancelled") return false;
  if (outcome === "completed" ? !webhook.runCompleted : !webhook.runFailed) return false;
  return runMs >= webhook.minDurationMinutes * 60_000;
}

/** Slack incoming-webhook body. Only the flow name and figures are sent, never run input or output. */
export function webhookPayload(run: Run, outcome: RunOutcome, now: Date = new Date()): { text: string } {
  const { title, body } = describeRun(run, outcome, now);
  const icon = outcome === "completed" ? ":white_check_mark:" : ":x:";
  return { text: `${icon} *AgentLab: ${title}*\n${body}` };
}

/** Share of steps done across the given runs, 0–1; undefined when there are no steps. */
export function progressOf(runs: Iterable<Run>): number | undefined {
  let done = 0;
  let total = 0;
  for (const run of runs) {
    done += doneSteps(run);
    total += run.steps.length;
  }
  return total === 0 ? undefined : done / total;
}

export function trayTooltip(activeCount: number, unseenFailures: number): string {
  const parts = [];
  if (activeCount > 0) parts.push(`${activeCount} ${activeCount === 1 ? "run" : "runs"} going`);
  if (unseenFailures > 0) parts.push(`${unseenFailures} failed`);
  return parts.length ? `AgentLab: ${parts.join(", ")}` : "AgentLab: no runs going";
}
