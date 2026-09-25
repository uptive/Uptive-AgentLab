import { useEffect, useState, useSyncExternalStore } from "react";
import type { Run } from "@agentlab/contracts";
import { getTelemetryStore, summarizeRun } from "@agentlab/observability";
import { theme } from "../theme.js";
import { useLiveSteps } from "../liveRuns.js";
import type { Catalog } from "./catalog.js";
import { formatMs, formatRelative, formatUsd } from "./format.js";
import { RunFeed } from "./RunFeed.js";
import { buildLiveStatus, buildRunFeed } from "./feedEntries.js";
import { RunGraph } from "./RunGraph.js";
import { stopRun } from "./runLauncher.js";
import { StatusBadge, buttonStyle, resolveRunFlow, useNow } from "./runUi.js";
import { Metric, StepPanel } from "./StepPanel.js";

function Breadcrumb({ items }: { items: { label: string; onClick?: () => void }[] }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, marginBottom: 12 }}>
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        return (
          <span key={index} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {item.onClick && !isLast ? (
              <button
                type="button"
                onClick={item.onClick}
                style={{ background: "none", border: "none", color: theme.primary, cursor: "pointer", padding: 0, fontSize: 13 }}
              >
                {item.label}
              </button>
            ) : (
              <span style={{ color: isLast ? theme.text : theme.textMuted }}>{item.label}</span>
            )}
            {!isLast ? <span style={{ color: theme.textMuted }}>/</span> : null}
          </span>
        );
      })}
    </div>
  );
}

interface Props {
  run: Run;
  catalog: Catalog;
  /** Label of the list this run was opened from, for the breadcrumb. */
  backLabel: string;
  onBack: () => void;
  onRerun: (run: Run) => void;
}

/** One run: the flow graph, the run's totals and a live feed; click an agent to focus on it. */
export function RunDetail({ run, catalog, backLabel, onBack, onRerun }: Props) {
  const store = getTelemetryStore();
  const events = useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.listEvents(run.id),
  );
  const liveSteps = useLiveSteps();
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>(undefined);
  const live = run.status === "running";
  const now = useNow(live);

  // Escape leaves the full-width agent view and brings the flow back.
  useEffect(() => {
    if (!selectedNodeId) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSelectedNodeId(undefined);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedNodeId]);
  const summary = summarizeRun(run, events);
  const flow = resolveRunFlow(run, catalog);
  const agentName = (agentId: string) => catalog.agentsById.get(agentId)?.name ?? agentId;
  const stepByNodeId = new Map(run.steps.map((step) => [step.nodeId, step]));
  const stepById = new Map(run.steps.map((step) => [step.id, step]));
  const feed = buildRunFeed(run, events, liveSteps, agentName);
  const status = buildLiveStatus(run, flow, liveSteps, agentName, now);

  const completedSteps = run.steps.filter((step) => step.status === "completed").length;
  const runningSteps = run.steps.filter((step) => step.status === "running");
  const durationMs = summary.durationMs ?? (live ? now - new Date(run.startedAt).getTime() : undefined);
  // Running steps have no final usage yet; add what they have streamed so far.
  const streamedTokens = runningSteps
    .filter((step) => !step.usage)
    .reduce((sum, step) => sum + (liveSteps.get(step.id)?.inputTokens ?? 0) + (liveSteps.get(step.id)?.outputTokens ?? 0), 0);
  const totalTokens = summary.inputTokens + summary.outputTokens + streamedTokens;

  const selectedNode = flow.nodes.find((node) => node.id === selectedNodeId);
  const selectedStep = selectedNodeId ? stepByNodeId.get(selectedNodeId) : undefined;
  const selectedLabel = selectedNode?.label ?? (selectedStep ? agentName(selectedStep.agentId) : "");
  const stepContext = selectedNode
    ? selectedNode.dependsOn.flatMap((depId) => {
        const parent = stepByNodeId.get(depId);
        return parent?.output !== undefined ? [{ agentName: agentName(parent.agentId), output: parent.output }] : [];
      })
    : [];
  const selectStep = (stepRunId: string) => setSelectedNodeId(stepById.get(stepRunId)?.nodeId);
  const stepLabel = (stepRunId: string) => {
    const step = stepById.get(stepRunId);
    return step ? (flow.nodes.find((node) => node.id === step.nodeId)?.label ?? agentName(step.agentId)) : "Agent";
  };

  const crumbs = [
    { label: backLabel, onClick: onBack },
    { label: flow.name, onClick: selectedStep ? () => setSelectedNodeId(undefined) : undefined },
    ...(selectedStep ? [{ label: selectedLabel }] : []),
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Breadcrumb items={crumbs} />

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <h1 style={{ margin: 0 }}>{flow.name}</h1>
        <StatusBadge status={run.status} />
        <div style={{ marginLeft: "auto" }}>
          {live ? (
            <button type="button" onClick={() => stopRun(run)} style={buttonStyle("danger")}>
              ◼ Stop
            </button>
          ) : (
            <button type="button" onClick={() => onRerun(run)} style={buttonStyle("secondary")}>
              ↻ Rerun
            </button>
          )}
        </div>
      </div>
      <p style={{ color: theme.textMuted, marginTop: 4, fontSize: 12 }}>
        Started {formatRelative(run.startedAt)} · {run.id}
        {run.authSource && run.authSource !== "unknown"
          ? ` · paid by ${run.authSource === "subscription" ? "Claude subscription" : "API key"}`
          : ""}
      </p>

      <div style={{ display: "flex", gap: 32, margin: "8px 0 16px", flexWrap: "wrap" }}>
        <Metric label="Progress" value={`${completedSteps} / ${Math.max(run.steps.length, flow.nodes.length)} steps`} />
        <Metric label={live ? "Latency (so far)" : "Latency"} value={formatMs(durationMs)} />
        <Metric label={live ? "Total tokens (so far)" : "Total tokens"} value={totalTokens.toLocaleString()} />
        <Metric label={live ? "Cost of finished steps" : "Estimated cost"} value={formatUsd(summary.estimatedCostUsd)} />
        {live ? (
          <Metric
            label="Running now"
            value={runningSteps.length > 0 ? runningSteps.map((step) => agentName(step.agentId)).join(", ") : "-"}
          />
        ) : null}
      </div>

      {/* A selected agent takes the full width; the graph comes back when it is closed. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: selectedStep ? "minmax(0, 1fr)" : "minmax(0, 1fr) 460px",
          gap: 16,
          flex: 1,
          minHeight: 480,
        }}
      >
        {selectedStep ? null : (
          <div style={{ position: "relative", borderRadius: 8, overflow: "hidden", border: `1px solid ${theme.border}` }}>
            <RunGraph
              flow={flow}
              run={run}
              agentsById={catalog.agentsById}
              selectedNodeId={selectedNodeId}
              onSelectNode={setSelectedNodeId}
              now={now}
            />
            <div style={{ position: "absolute", top: 10, left: 12, fontSize: 12, color: theme.textMuted, pointerEvents: "none" }}>
              Click an agent to see its own activity, tokens, cost and latency.
            </div>
          </div>
        )}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            background: theme.surface,
            border: `1px solid ${theme.border}`,
            borderRadius: 8,
            padding: 16,
            overflow: selectedStep ? "auto" : "hidden",
          }}
        >
          {selectedStep ? (
            <StepPanel
              step={selectedStep}
              agent={catalog.agentsById.get(selectedStep.agentId)}
              label={selectedLabel}
              feed={feed.filter((entry) => entry.stepRunId === selectedStep.id)}
              live={liveSteps.get(selectedStep.id)}
              status={status.filter((line) => line.stepRunId === selectedStep.id)}
              context={stepContext}
              now={now}
              onClose={() => setSelectedNodeId(undefined)}
            />
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 12 }}>
                <strong style={{ fontSize: 16 }}>{live ? "Live feed" : "Feed"}</strong>
                <span style={{ fontSize: 12, color: theme.textMuted }}>Everything every agent did, in order</span>
              </div>
              <RunFeed entries={feed} live={live} agentLabel={stepLabel} onSelectStep={selectStep} status={status} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
