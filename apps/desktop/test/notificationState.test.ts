import { describe, expect, it } from "vitest";
import type { AgentDefinition, Run, StepRun } from "@agentlab/contracts";
import { DEFAULT_NOTIFICATION_SETTINGS, NotificationSettingsSchema } from "../electron/notificationSettings.js";
import {
  describeDigest,
  describeOptimization,
  describeRun,
  formatDuration,
  outcomeOf,
  progressOf,
  wantsNotification,
  wantsWebhook,
  webhookPayload,
  type NotifyEvent,
} from "../electron/notificationState.js";

const usage = (inputTokens: number, outputTokens: number, estimatedCostUsd: number) => ({ inputTokens, outputTokens, estimatedCostUsd, latencyMs: 0 });

function step(nodeId: string, status: StepRun["status"], extra: Partial<StepRun> = {}): StepRun {
  return { id: `s-${nodeId}`, runId: "r1", nodeId, agentId: `agent-${nodeId}`, status, input: {}, toolCalls: [], ...extra };
}

function run(steps: StepRun[], extra: Partial<Run> = {}): Run {
  return {
    id: "r1",
    flowId: "support-triage",
    status: "completed",
    startedAt: "2026-09-25T12:00:00.000Z",
    completedAt: "2026-09-25T12:00:12.400Z",
    steps,
    flow: { id: "support-triage", name: "Support triage flow", nodes: steps.map((s) => ({ id: s.nodeId, agentId: s.agentId, dependsOn: [] })) },
    ...extra,
  };
}

describe("describeRun", () => {
  it("reads like the design for a completed run", () => {
    const done = run([step("a", "completed"), step("b", "completed"), step("c", "completed"), step("d", "completed")], { totalUsage: usage(3000, 812, 0.0214) });
    expect(describeRun(done, "completed")).toEqual({
      title: "Support triage flow finished",
      body: "4 of 4 steps completed · 12.4s · 3,812 tok · $0.0214",
    });
  });

  it("leads a failure with the failing step, its label and error", () => {
    const steps = [step("a", "completed"), step("b", "completed"), step("parser", "failed", { error: "rate limit exceeded" }), step("d", "pending"), step("e", "pending")];
    const failed = run(steps, { status: "failed", completedAt: "2026-09-25T12:00:07.200Z" });
    failed.flow?.nodes.splice(2, 1, { id: "parser", agentId: "agent-parser", dependsOn: [], label: "Line-item parser" });
    expect(describeRun(failed, "failed")).toEqual({
      title: "Support triage flow failed",
      body: "Step 3 of 5, Line-item parser: rate limit exceeded after 7.2s",
    });
  });

  it("falls back to the agent name when the node has no label", () => {
    const failed = run([step("a", "failed", { error: "boom" })], { status: "failed", agents: [{ id: "agent-a", name: "Planner" } as AgentDefinition] });
    expect(describeRun(failed, "failed").body).toMatch(/^Step 1 of 1, Planner: boom/);
  });

  it("counts step usage when the run has no total", () => {
    const partial = run([step("a", "completed", { usage: usage(100, 50, 0.001) }), step("b", "pending")]);
    expect(describeRun(partial, "cancelled")).toEqual({ title: "Support triage flow was stopped", body: "1 of 2 steps completed · 12.4s · 150 tok · $0.0010" });
  });
});

describe("outcomeOf", () => {
  it("treats an aborted run as cancelled whatever its status", () => {
    expect(outcomeOf(run([], { status: "failed" }), true)).toBe("cancelled");
    expect(outcomeOf(run([], { status: "failed" }), false)).toBe("failed");
    expect(outcomeOf(run([]), false)).toBe("completed");
  });
});

describe("formatDuration", () => {
  it("uses tenths under a minute, then minutes and hours", () => {
    expect(formatDuration(7200)).toBe("7.2s");
    expect(formatDuration(189_600)).toBe("3m 10s");
    expect(formatDuration(3_900_000)).toBe("1h 5m");
  });
});

describe("describeOptimization", () => {
  it("reads like the design", () => {
    expect(describeOptimization({ flowName: "Support triage flow", recommendations: 6, highSeverity: 2, savedUsdPerRun: 0.0081 })).toEqual({
      title: "Optimize reviewed Support triage flow",
      body: "6 recommendations, 2 high severity · est. $0.0081 saved per run",
    });
  });

  it("leaves out savings that are not savings", () => {
    expect(describeOptimization({ flowName: "F", recommendations: 1, highSeverity: 0, savedUsdPerRun: -0.01 }).body).toBe("1 recommendation");
  });
});

describe("describeDigest", () => {
  const finished = (status: StepRun["status"], cost: number): NotifyEvent => ({
    kind: "run",
    run: run([step("a", status)], { totalUsage: usage(1, 1, cost) }),
    outcome: status === "completed" ? "completed" : "failed",
  });

  it("sums runs like the design", () => {
    const digest = describeDigest([finished("completed", 0.02), finished("completed", 0.0114), finished("failed", 0.01)]);
    expect(digest).toEqual({ title: "3 runs finished", body: "2 completed, 1 failed · 37.2s total · $0.0414" });
  });

  it("names mixed bursts as updates", () => {
    const optimization: NotifyEvent = { kind: "optimization", flowName: "F", recommendations: 1, highSeverity: 0, savedUsdPerRun: 0 };
    expect(describeDigest([finished("completed", 0), optimization, optimization]).title).toBe("3 updates");
    expect(describeDigest([finished("completed", 0), optimization, optimization]).body).toMatch(/^1 completed, 2 optimizations/);
  });
});

describe("settings", () => {
  it("fills defaults for a missing or partial file", () => {
    expect(NotificationSettingsSchema.parse({ sound: false })).toEqual({ ...DEFAULT_NOTIFICATION_SETTINGS, sound: false });
    expect(DEFAULT_NOTIFICATION_SETTINGS.webhook.enabled).toBe(false);
  });

  it("rejects values of the wrong type", () => {
    expect(NotificationSettingsSchema.safeParse({ runFailed: "yes" }).success).toBe(false);
  });

  it("follows the per-event toggles", () => {
    const settings = { ...DEFAULT_NOTIFICATION_SETTINGS, runCompleted: false };
    expect(wantsNotification(settings, { kind: "run", run: run([]), outcome: "completed" })).toBe(false);
    expect(wantsNotification(settings, { kind: "run", run: run([]), outcome: "failed" })).toBe(true);
    expect(wantsNotification(settings, { kind: "run", run: run([]), outcome: "cancelled" })).toBe(false);
  });
});

describe("webhook", () => {
  const enabled = { ...DEFAULT_NOTIFICATION_SETTINGS, webhook: { ...DEFAULT_NOTIFICATION_SETTINGS.webhook, enabled: true, minDurationMinutes: 5 } };

  it("posts only long runs, and never stopped ones", () => {
    expect(wantsWebhook(enabled, "completed", 5 * 60_000)).toBe(true);
    expect(wantsWebhook(enabled, "completed", 4 * 60_000)).toBe(false);
    expect(wantsWebhook(enabled, "cancelled", 60 * 60_000)).toBe(false);
    expect(wantsWebhook(DEFAULT_NOTIFICATION_SETTINGS, "failed", 60 * 60_000)).toBe(false);
  });

  it("never includes run input or output", () => {
    const secret = run([step("a", "completed", { input: { token: "s3cret" }, output: "private answer" })], { input: { token: "s3cret" } });
    expect(JSON.stringify(webhookPayload(secret, "completed"))).not.toMatch(/s3cret|private answer/);
  });
});

describe("progressOf", () => {
  it("is the share of finished steps across runs", () => {
    expect(progressOf([run([step("a", "completed"), step("b", "running")]), run([step("c", "failed"), step("d", "pending")])])).toBe(0.5);
    expect(progressOf([])).toBeUndefined();
  });
});
