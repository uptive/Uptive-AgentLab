import type { StepRun } from "@agentlab/contracts";

export function formatMs(ms: number | undefined): string {
  if (ms === undefined) return "-";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

export function formatUsd(usd: number): string {
  return `$${usd.toFixed(4)}`;
}

export function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff)) return "-";
  const sec = Math.round(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

/** Wall-clock time of a step; for a running step, how long it has been running as of `now`. */
export function stepLatencyMs(step: StepRun, now = Date.now()): number | undefined {
  if (!step.startedAt) return undefined;
  const start = new Date(step.startedAt).getTime();
  if (step.completedAt) return new Date(step.completedAt).getTime() - start;
  return step.status === "running" ? Math.max(0, now - start) : undefined;
}
