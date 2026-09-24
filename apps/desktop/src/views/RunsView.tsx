import { useEffect, useState, useSyncExternalStore } from "react";
import type { AgentDefinition, FlowDefinition, Run, RunStatus, StepRun } from "@agentlab/contracts";
import { getTelemetryStore, summarizeRun } from "@agentlab/observability";
import { demoAgents, findAgent } from "@agentlab/agent-runtime";
import { computeFlowLayers, demoFlow, findFlow } from "@agentlab/flow-engine";
import { theme } from "../theme.js";
import { demoRun, demoTraceEvents } from "../demoRuns.js";

const STATUS_COLORS: Record<RunStatus, string> = {
  pending: theme.statusDraft,
  running: theme.warning,
  completed: theme.statusActive,
  failed: theme.danger,
};

function StatusBadge({ status }: { status: RunStatus }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        color: theme.onStatus,
        background: STATUS_COLORS[status],
        textTransform: "capitalize",
      }}
    >
      {status}
    </span>
  );
}

function formatMs(ms: number | undefined): string {
  if (ms === undefined) return "-";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function formatUsd(usd: number): string {
  return `$${usd.toFixed(4)}`;
}

function formatRelative(iso: string): string {
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

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre
      style={{
        background: theme.codeBg,
        border: `1px solid ${theme.border}`,
        borderRadius: 6,
        padding: 10,
        fontSize: 12,
        overflow: "auto",
        maxHeight: 220,
        margin: 0,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: theme.textMuted }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 600 }}>{value}</div>
    </div>
  );
}

function StepDetail({
  step,
  agent,
  context,
}: {
  step: StepRun;
  agent: AgentDefinition | undefined;
  context: { agentName: string; output: unknown }[];
}) {
  const latencyMs =
    step.startedAt && step.completedAt
      ? new Date(step.completedAt).getTime() - new Date(step.startedAt).getTime()
      : undefined;

  return (
    <div
      style={{
        background: theme.surface,
        border: `1px solid ${theme.border}`,
        borderRadius: 8,
        padding: 16,
        marginTop: 16,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <strong>{agent?.name ?? step.agentId}</strong>
          <div style={{ fontSize: 12, color: theme.textMuted }}>{agent?.role}</div>
        </div>
        <StatusBadge status={step.status} />
      </div>

      <div style={{ display: "flex", gap: 24, margin: "12px 0", fontSize: 12, color: theme.textMuted }}>
        <span>Model: {agent?.model ?? "-"}</span>
        <span>Input tokens: {step.usage?.inputTokens ?? "-"}</span>
        <span>Output tokens: {step.usage?.outputTokens ?? "-"}</span>
        <span>Cost: {step.usage ? formatUsd(step.usage.estimatedCostUsd) : "-"}</span>
        <span>Latency: {formatMs(latencyMs)}</span>
      </div>

      {step.error ? (
        <div style={{ color: theme.danger, marginBottom: 12 }}>Error: {step.error}</div>
      ) : null}

      {agent?.systemInstructions ? (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 4 }}>System instructions</div>
          <div
            style={{
              background: theme.codeBg,
              border: `1px solid ${theme.border}`,
              borderRadius: 6,
              padding: 10,
              fontSize: 12,
              lineHeight: 1.5,
              whiteSpace: "pre-wrap",
            }}
          >
            {agent.systemInstructions}
          </div>
        </div>
      ) : null}

      {context.length > 0 ? (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 4 }}>
            Context from previous steps
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {context.map((entry, index) => (
              <div key={index}>
                <div style={{ fontSize: 12, marginBottom: 2 }}>
                  <strong>{entry.agentName}</strong>
                </div>
                <JsonBlock value={entry.output ?? null} />
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 4 }}>Input</div>
          <JsonBlock value={step.input} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 4 }}>Output</div>
          <JsonBlock value={step.output ?? null} />
        </div>
      </div>

      {step.toolCalls.length > 0 ? (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 4 }}>Tool calls</div>
          {step.toolCalls.map((call, index) => (
            <div
              key={index}
              style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 12, marginBottom: 8 }}
            >
              <div style={{ fontSize: 12 }}>
                <strong>{call.toolId}</strong> (
                {formatMs(new Date(call.completedAt).getTime() - new Date(call.startedAt).getTime())})
              </div>
              <div />
              <JsonBlock value={call.input} />
              <JsonBlock value={call.output} />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Breadcrumb({ items }: { items: { label: string; onClick?: () => void }[] }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, marginBottom: 12 }}>
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        return (
          <span key={index} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {item.onClick && !isLast ? (
              <button
                onClick={item.onClick}
                style={{
                  background: "none",
                  border: "none",
                  color: theme.primary,
                  cursor: "pointer",
                  padding: 0,
                  fontSize: 13,
                }}
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

function RunDetail({ run, onBack }: { run: Run; onBack: () => void }) {
  const store = getTelemetryStore();
  const [selectedStepId, setSelectedStepId] = useState<string | undefined>(undefined);
  const events = store.listEvents(run.id);
  const summary = summarizeRun(run, events);
  const flow: FlowDefinition = findFlow(run.flowId) ?? demoFlow;
  const layers = computeFlowLayers(flow);
  const selectedStep = run.steps.find((step) => step.id === selectedStepId);
  const selectedAgent = selectedStep ? findAgent(selectedStep.agentId, demoAgents) : undefined;
  const totalTokens = summary.inputTokens + summary.outputTokens;

  const stepByNodeId = new Map(run.steps.map((step) => [step.nodeId, step]));
  const agentsInRun = run.steps.map((step) => findAgent(step.agentId, demoAgents) ?? undefined);
  const agentNames = Array.from(
    new Set(agentsInRun.map((agent, index) => agent?.name ?? run.steps[index].agentId)),
  );
  const modelsUsed = Array.from(
    new Set(agentsInRun.map((agent) => agent?.model).filter((model): model is string => Boolean(model))),
  );

  const selectedNode = selectedStep ? flow.nodes.find((node) => node.id === selectedStep.nodeId) : undefined;
  const stepContext = selectedNode
    ? selectedNode.dependsOn
        .map((depId) => {
          const parentStep = stepByNodeId.get(depId);
          if (!parentStep) return undefined;
          const parentAgent = findAgent(parentStep.agentId, demoAgents);
          return { agentName: parentAgent?.name ?? parentStep.agentId, output: parentStep.output };
        })
        .filter((entry): entry is { agentName: string; output: unknown } => entry !== undefined)
    : [];

  const crumbs = [
    { label: "All runs", onClick: onBack },
    { label: flow.name, onClick: selectedStep ? () => setSelectedStepId(undefined) : undefined },
    ...(selectedStep && selectedAgent ? [{ label: selectedAgent.name }] : []),
  ];

  return (
    <div>
      <Breadcrumb items={crumbs} />

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <h1 style={{ margin: 0 }}>{flow.name}</h1>
        <StatusBadge status={summary.status} />
      </div>
      <p style={{ color: theme.textMuted, marginTop: 4, fontSize: 12 }}>
        Started {formatRelative(run.startedAt)} · {run.id}
      </p>

      <div style={{ display: "flex", gap: 24, margin: "16px 0", flexWrap: "wrap" }}>
        <Metric label="Duration" value={formatMs(summary.durationMs)} />
        <Metric label="Total tokens" value={totalTokens.toLocaleString()} />
        <Metric label="Estimated cost" value={formatUsd(summary.estimatedCostUsd)} />
        <Metric label="Steps" value={String(run.steps.length)} />
      </div>
      <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 8 }}>
        {summary.inputTokens.toLocaleString()} in · {summary.outputTokens.toLocaleString()} out ·{" "}
        {summary.modelCallCount} model calls · {summary.toolCallCount} tool calls
      </div>
      <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 4 }}>
        <span style={{ color: theme.text }}>Agents:</span> {agentNames.join(" · ")}
      </div>
      <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 16 }}>
        <span style={{ color: theme.text }}>Models:</span>{" "}
        {modelsUsed.length > 0 ? modelsUsed.join(" · ") : "-"}
      </div>

      <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 8 }}>
        {selectedStep
          ? "Flow trace — click another step to switch focus, or the flow name above to zoom out."
          : "Flow trace — click a step to inspect its input, output, tokens and tool calls."}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {layers.map((layer, layerIndex) => (
          <div key={layerIndex} style={{ display: "flex", gap: 12 }}>
            {layer.map((node) => {
              const step = run.steps.find((s) => s.nodeId === node.id);
              const agent = findAgent(node.agentId, demoAgents);
              if (!step) return null;
              const isSelected = step.id === selectedStepId;
              const isDimmed = selectedStepId !== undefined && !isSelected;
              const stepLatencyMs =
                step.startedAt && step.completedAt
                  ? new Date(step.completedAt).getTime() - new Date(step.startedAt).getTime()
                  : undefined;
              return (
                <button
                  key={node.id}
                  onClick={() => setSelectedStepId(step.id)}
                  style={{
                    flex: 1,
                    textAlign: "left",
                    cursor: "pointer",
                    background: isSelected ? theme.surfaceSelected : theme.surface,
                    border: `1px solid ${isSelected ? theme.primary : theme.border}`,
                    borderRadius: 8,
                    padding: 12,
                    color: theme.text,
                    opacity: isDimmed ? 0.5 : 1,
                    transition: "opacity 120ms ease, border-color 120ms ease",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <strong style={{ fontSize: 13 }}>{agent?.name ?? node.agentId}</strong>
                    <StatusBadge status={step.status} />
                  </div>
                  <div style={{ fontSize: 12, color: theme.textMuted, marginTop: 4 }}>
                    {formatMs(stepLatencyMs)} ·{" "}
                    {step.usage ? `${step.usage.inputTokens + step.usage.outputTokens} tok` : "-"}
                  </div>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {selectedStep ? <StepDetail step={selectedStep} agent={selectedAgent} context={stepContext} /> : null}
    </div>
  );
}

function useRuns(): Run[] {
  const store = getTelemetryStore();
  return useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.listRuns(),
    () => store.listRuns(),
  );
}

export function RunsView() {
  const store = getTelemetryStore();
  const runs = useRuns();
  const [selectedRunId, setSelectedRunId] = useState<string | undefined>(undefined);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void store.hydrate().then(() => {
      if (cancelled) return;
      if (store.listRuns().length === 0) {
        // Seed with the workshop's demo scenario until Flow Orchestration produces real runs.
        for (const event of demoTraceEvents) store.recordEvent(event);
        store.saveRun(demoRun);
      }
      setHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, [store]);

  const selectedRun = selectedRunId ? runs.find((run) => run.id === selectedRunId) : undefined;
  if (selectedRun) {
    return <RunDetail run={selectedRun} onBack={() => setSelectedRunId(undefined)} />;
  }

  return (
    <div>
      <h1 style={{ margin: 0 }}>Runs</h1>
      <p style={{ color: theme.textMuted, marginTop: 4 }}>
        Recent flow executions. Click a run to drill into its trace and agents.
      </p>
      {!hydrated ? (
        <p style={{ color: theme.textMuted }}>Loading…</p>
      ) : runs.length === 0 ? (
        <p>No runs yet.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 16 }}>
          {runs.map((run) => {
            const summary = summarizeRun(run, store.listEvents(run.id));
            return (
              <button
                key={run.id}
                onClick={() => setSelectedRunId(run.id)}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 110px 90px 110px 100px",
                  alignItems: "center",
                  gap: 12,
                  textAlign: "left",
                  cursor: "pointer",
                  background: theme.surface,
                  border: `1px solid ${theme.border}`,
                  borderRadius: 8,
                  padding: 12,
                  color: theme.text,
                }}
              >
                <div>
                  <strong>{findFlow(run.flowId)?.name ?? run.flowId}</strong>
                  <div style={{ fontSize: 12, color: theme.textMuted }}>
                    {formatRelative(run.startedAt)} · {run.steps.length} steps
                  </div>
                </div>
                <StatusBadge status={summary.status} />
                <span style={{ fontSize: 13 }}>{formatMs(summary.durationMs)}</span>
                <span style={{ fontSize: 13 }}>
                  {(summary.inputTokens + summary.outputTokens).toLocaleString()} tok
                </span>
                <span style={{ fontSize: 13 }}>{formatUsd(summary.estimatedCostUsd)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
