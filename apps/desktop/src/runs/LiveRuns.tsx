import { useState } from "react";
import type { Run, StepStatus } from "@agentlab/contracts";
import { summarizeRun } from "@agentlab/observability";
import { theme } from "../theme.js";
import { useLiveStep, type LiveStep } from "../liveRuns.js";
import type { Catalog } from "./catalog.js";
import { formatMs, formatRelative, formatUsd } from "./format.js";
import { stopRun } from "./runLauncher.js";
import { partitionLiveRuns } from "./runLists.js";
import { StatusBadge, buttonStyle, resolveRunFlow, useNow } from "./runUi.js";

const STEP_ICONS: Record<StepStatus, string> = { pending: "○", running: "◉", completed: "✓", failed: "✗" };
const STEP_COLORS: Record<StepStatus, string> = {
  pending: theme.textMuted,
  running: theme.warning,
  completed: theme.statusActive,
  failed: theme.danger,
};

/** One line on what a step is doing right now, from its live stream. */
function describeActivity(live: LiveStep | undefined): string | undefined {
  const last = live?.blocks[live.blocks.length - 1];
  if (!last) return undefined;
  if (last.kind === "tool_use") return `Using ${last.toolName ?? "a tool"}`;
  const text = last.text.trim().split("\n").pop()?.trim();
  if (!text) return last.kind === "thinking" ? "Thinking…" : undefined;
  return last.kind === "thinking" ? `Thinking: ${text}` : text;
}

function RunCard({ run, catalog, now, onOpen }: { run: Run; catalog: Catalog; now: number; onOpen: (runId: string) => void }) {
  const flow = resolveRunFlow(run, catalog);
  const summary = summarizeRun(run);
  const stepByNodeId = new Map(run.steps.map((step) => [step.nodeId, step]));
  const agentName = (agentId: string) => catalog.agentsById.get(agentId)?.name ?? agentId;
  const runningSteps = run.steps.filter((step) => step.status === "running");
  const live = useLiveStep(runningSteps[0]?.id);
  const activity = describeActivity(live);
  const completed = run.steps.filter((step) => step.status === "completed").length;
  const total = Math.max(run.steps.length, flow.nodes.length);
  const progress = total > 0 ? completed / total : 0;
  const tokens = summary.inputTokens + summary.outputTokens;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        background: theme.surface,
        border: `1px solid ${theme.border}`,
        borderRadius: 8,
        padding: 14,
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{flow.name}</strong>
        <span style={{ marginLeft: "auto", fontSize: 12, color: theme.warning, whiteSpace: "nowrap" }}>
          ● {formatMs(now - new Date(run.startedAt).getTime())}
        </span>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {flow.nodes.map((node) => {
          const status = stepByNodeId.get(node.id)?.status ?? "pending";
          return (
            <span
              key={node.id}
              title={status}
              style={{
                fontSize: 12,
                padding: "2px 8px",
                borderRadius: 999,
                border: `1px solid ${status === "running" ? theme.warning : theme.border}`,
                color: status === "pending" ? theme.textMuted : theme.text,
              }}
            >
              <span style={{ color: STEP_COLORS[status] }}>{STEP_ICONS[status]}</span> {node.label ?? agentName(node.agentId)}
            </span>
          );
        })}
      </div>

      <div style={{ fontSize: 13, minHeight: 36 }}>
        <div>
          <span style={{ color: theme.textMuted }}>Now: </span>
          {runningSteps.length > 0 ? runningSteps.map((step) => agentName(step.agentId)).join(", ") : "Waiting for the next step"}
        </div>
        {activity ? (
          <div style={{ color: theme.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {activity}
          </div>
        ) : null}
      </div>

      <div>
        <div style={{ height: 6, borderRadius: 3, background: theme.border, overflow: "hidden" }}>
          <div style={{ width: `${progress * 100}%`, height: "100%", background: theme.primary, transition: "width 0.3s" }} />
        </div>
        <div style={{ display: "flex", gap: 12, fontSize: 12, color: theme.textMuted, marginTop: 4 }}>
          <span>
            {completed} / {total} steps
          </span>
          <span>{tokens.toLocaleString()} tok</span>
          <span>{formatUsd(summary.estimatedCostUsd)}</span>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <button type="button" onClick={() => onOpen(run.id)} style={buttonStyle("secondary")}>
          Open
        </button>
        <button type="button" onClick={() => stopRun(run)} title="Stop this run" style={buttonStyle("danger")}>
          ◼ Stop
        </button>
      </div>
    </div>
  );
}

function StopAllButton({ runs }: { runs: Run[] }) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} style={buttonStyle("danger")}>
        ◼ Stop all
      </button>
    );
  }
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13 }}>
      Stop {runs.length} {runs.length === 1 ? "run" : "runs"}?
      <button
        type="button"
        onClick={() => {
          runs.forEach(stopRun);
          setConfirming(false);
        }}
        style={buttonStyle("danger")}
      >
        Yes, stop
      </button>
      <button type="button" onClick={() => setConfirming(false)} style={buttonStyle("secondary")}>
        Cancel
      </button>
    </span>
  );
}

/** Dashboard of what is executing now, plus runs that just finished. */
export function LiveRuns({ runs, catalog, onOpen }: { runs: Run[]; catalog: Catalog; onOpen: (runId: string) => void }) {
  const now = useNow(true, 1000);
  const { active, recentlyFinished } = partitionLiveRuns(runs, now);
  const totals = active.map((run) => summarizeRun(run));
  const totalTokens = totals.reduce((sum, s) => sum + s.inputTokens + s.outputTokens, 0);
  const totalCost = totals.reduce((sum, s) => sum + s.estimatedCostUsd, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {active.length === 0 ? (
        <p style={{ color: theme.textMuted, margin: 0 }}>
          Nothing is running. Click <strong>Start execution</strong> to kick something off.
        </p>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 13 }}>
            <span>
              <strong>{active.length}</strong> running · {totalTokens.toLocaleString()} tok · {formatUsd(totalCost)}
            </span>
            <span style={{ marginLeft: "auto" }}>
              <StopAllButton runs={active} />
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
            {active.map((run) => (
              <RunCard key={run.id} run={run} catalog={catalog} now={now} onOpen={onOpen} />
            ))}
          </div>
        </>
      )}

      {recentlyFinished.length > 0 ? (
        <div>
          <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 6 }}>Just finished</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {recentlyFinished.map((run) => (
              <button
                key={run.id}
                type="button"
                onClick={() => onOpen(run.id)}
                style={{
                  display: "grid",
                  gridTemplateColumns: "110px 1fr 90px 90px",
                  alignItems: "center",
                  gap: 12,
                  textAlign: "left",
                  cursor: "pointer",
                  background: theme.surface,
                  border: `1px solid ${theme.border}`,
                  borderRadius: 8,
                  padding: "8px 12px",
                  color: theme.text,
                  fontSize: 13,
                }}
              >
                <StatusBadge status={run.status} />
                <span>{resolveRunFlow(run, catalog).name}</span>
                <span style={{ color: theme.textMuted }}>{run.completedAt ? formatRelative(run.completedAt) : "-"}</span>
                <span>{formatUsd(summarizeRun(run).estimatedCostUsd)}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
