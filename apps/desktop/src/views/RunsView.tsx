import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { AgentDefinition, FlowDefinition, Run, RunStatus, StepRun } from "@agentlab/contracts";
import { getTelemetryStore, summarizeRun } from "@agentlab/observability";
import { demoAgents, findAgent } from "@agentlab/agent-runtime";
import { computeFlowLayers, demoFlow, findFlow } from "@agentlab/flow-engine";
import { theme } from "../theme.js";
import { demoRuns, demoTraceEvents } from "../demoRuns.js";

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

// Fake-orchestrate a rerun by cloning a run with a new id, showing it as
// "running" immediately, then flipping it to "completed" after a short delay.
function buildRerun(source: Run): { running: Run; completed: Run } {
  const now = Date.now();
  const newRunId = `run-rerun-${now.toString(36)}`;
  const running: Run = {
    ...source,
    id: newRunId,
    status: "running",
    startedAt: new Date(now).toISOString(),
    completedAt: undefined,
    steps: source.steps.map((step, i) => ({
      ...step,
      id: `${newRunId}-step-${i}`,
      runId: newRunId,
      status: "pending",
      startedAt: undefined,
      completedAt: undefined,
      output: undefined,
      error: undefined,
    })),
    totalUsage: undefined,
  };
  const completed: Run = {
    ...running,
    status: "completed",
    completedAt: new Date(now + 2000).toISOString(),
    steps: running.steps.map((step, i) => {
      const original = source.steps[i];
      return {
        ...step,
        status: "completed",
        startedAt: new Date(now + i * 200).toISOString(),
        completedAt: new Date(now + (i + 1) * 200).toISOString(),
        output: original.output,
        usage: original.usage,
        toolCalls: original.toolCalls,
      };
    }),
    totalUsage: source.totalUsage,
  };
  return { running, completed };
}

// Fake-orchestrate a fresh run built straight from a flow definition.
function buildRunFromFlow(flow: FlowDefinition, input: unknown): { running: Run; completed: Run } {
  const now = Date.now();
  const newRunId = `run-${now.toString(36)}`;
  const steps: StepRun[] = flow.nodes.map((node, i) => ({
    id: `${newRunId}-step-${i}`,
    runId: newRunId,
    nodeId: node.id,
    agentId: node.agentId,
    status: "pending",
    input,
    toolCalls: [],
  }));
  const running: Run = {
    id: newRunId,
    flowId: flow.id,
    status: "running",
    startedAt: new Date(now).toISOString(),
    steps,
  };
  const completed: Run = {
    ...running,
    status: "completed",
    completedAt: new Date(now + 2000).toISOString(),
    steps: steps.map((step, i) => ({
      ...step,
      status: "completed",
      startedAt: new Date(now + i * 200).toISOString(),
      completedAt: new Date(now + (i + 1) * 200).toISOString(),
      output: { note: `Simulated output from ${step.agentId}` },
      usage: { inputTokens: 800, outputTokens: 400, estimatedCostUsd: 0.012, latencyMs: 200 },
    })),
    totalUsage: {
      inputTokens: 800 * steps.length,
      outputTokens: 400 * steps.length,
      estimatedCostUsd: 0.012 * steps.length,
      latencyMs: 200 * steps.length,
    },
  };
  return { running, completed };
}

const AVAILABLE_FLOWS: FlowDefinition[] = [demoFlow];

function NewRunDialog({
  onCancel,
  onStart,
}: {
  onCancel: () => void;
  onStart: (flow: FlowDefinition, input: unknown) => void;
}) {
  const [flowId, setFlowId] = useState<string>(AVAILABLE_FLOWS[0].id);
  const [inputText, setInputText] = useState<string>(
    JSON.stringify({ pullRequestId: 42, repository: "acme/checkout" }, null, 2),
  );
  const [error, setError] = useState<string | undefined>(undefined);
  const flow = AVAILABLE_FLOWS.find((f) => f.id === flowId) ?? AVAILABLE_FLOWS[0];

  const submit = () => {
    let parsed: unknown = undefined;
    const trimmed = inputText.trim();
    if (trimmed.length > 0) {
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        setError("Input must be valid JSON (or empty).");
        return;
      }
    }
    onStart(flow, parsed);
  };

  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: theme.backdrop,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: theme.surface,
          border: `1px solid ${theme.border}`,
          borderRadius: 12,
          padding: 24,
          width: 520,
          maxWidth: "90vw",
          color: theme.text,
          boxShadow: theme.drawerShadow,
        }}
      >
        <h2 style={{ margin: 0, marginBottom: 4 }}>Start execution</h2>
        <p style={{ color: theme.textMuted, marginTop: 0, marginBottom: 20, fontSize: 13 }}>
          Pick a flow and provide the input payload. The run appears in the list immediately.
        </p>

        <label style={{ display: "block", fontSize: 12, color: theme.textMuted, marginBottom: 6 }}>
          Flow
        </label>
        <select
          value={flowId}
          onChange={(e) => setFlowId(e.target.value)}
          style={{
            width: "100%",
            padding: "8px 10px",
            marginBottom: 16,
            background: theme.codeBg,
            color: theme.text,
            border: `1px solid ${theme.border}`,
            borderRadius: 6,
            fontSize: 14,
          }}
        >
          {AVAILABLE_FLOWS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        <div style={{ fontSize: 12, color: theme.textMuted, marginTop: -12, marginBottom: 16 }}>
          {flow.description}
        </div>

        <label style={{ display: "block", fontSize: 12, color: theme.textMuted, marginBottom: 6 }}>
          Input (JSON)
        </label>
        <textarea
          value={inputText}
          onChange={(e) => {
            setInputText(e.target.value);
            setError(undefined);
          }}
          rows={7}
          style={{
            width: "100%",
            padding: 10,
            background: theme.codeBg,
            color: theme.text,
            border: `1px solid ${error ? theme.danger : theme.border}`,
            borderRadius: 6,
            fontFamily: theme.fontMono,
            fontSize: 12,
            resize: "vertical",
            boxSizing: "border-box",
          }}
        />
        {error && (
          <div style={{ color: theme.danger, fontSize: 12, marginTop: 6 }}>{error}</div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: "8px 16px",
              borderRadius: 6,
              border: `1px solid ${theme.border}`,
              background: "transparent",
              color: theme.text,
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            style={{
              padding: "8px 16px",
              borderRadius: 6,
              border: `1px solid ${theme.primary}`,
              background: theme.primary,
              color: theme.onPrimary,
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            ▶ Run
          </button>
        </div>
      </div>
    </div>
  );
}

export function RunsView() {
  const store = getTelemetryStore();
  const runs = useRuns();
  const [selectedRunId, setSelectedRunId] = useState<string | undefined>(undefined);
  const [hydrated, setHydrated] = useState(false);
  const [newRunOpen, setNewRunOpen] = useState(false);

  // Track pending rerun completions so Stop can cancel them.
  const rerunTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const timers = rerunTimers.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  const handleRerun = useCallback(
    (run: Run) => {
      const { running, completed } = buildRerun(run);
      store.saveRun(running);
      const timer = setTimeout(() => {
        rerunTimers.current.delete(running.id);
        store.saveRun(completed);
      }, 2000);
      rerunTimers.current.set(running.id, timer);
    },
    [store],
  );

  const handleStop = useCallback(
    (run: Run) => {
      const pending = rerunTimers.current.get(run.id);
      if (pending) {
        clearTimeout(pending);
        rerunTimers.current.delete(run.id);
      }
      const now = new Date().toISOString();
      const stopped: Run = {
        ...run,
        status: "failed",
        completedAt: now,
        steps: run.steps.map((step) =>
          step.status === "running" || step.status === "pending"
            ? {
                ...step,
                status: "failed",
                completedAt: step.completedAt ?? now,
                error: step.error ?? "Cancelled by user",
              }
            : step,
        ),
      };
      store.saveRun(stopped);
    },
    [store],
  );

  const handleStart = useCallback(
    (flow: FlowDefinition, input: unknown) => {
      const { running, completed } = buildRunFromFlow(flow, input);
      store.saveRun(running);
      const timer = setTimeout(() => {
        rerunTimers.current.delete(running.id);
        store.saveRun(completed);
      }, 2000);
      rerunTimers.current.set(running.id, timer);
      setNewRunOpen(false);
    },
    [store],
  );

  useEffect(() => {
    let cancelled = false;
    void store.hydrate().then(() => {
      if (cancelled) return;
      // Seed missing demo runs idempotently so a store that already has some
      // runs (from Mongo or a previous session) still gets any new demo ids.
      const existing = new Set(store.listRuns().map((run) => run.id));
      const missing = demoRuns.filter((run) => !existing.has(run.id));
      if (missing.length > 0) {
        const missingIds = new Set(missing.map((run) => run.id));
        for (const event of demoTraceEvents) {
          if (missingIds.has(event.runId)) store.recordEvent(event);
        }
        for (const run of missing) store.saveRun(run);
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
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 16,
        }}
      >
        <div>
          <h1 style={{ margin: 0 }}>Runs</h1>
          <p style={{ color: theme.textMuted, marginTop: 4 }}>
            Recent flow executions. Click a run to drill into its trace and agents.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setNewRunOpen(true)}
          style={{
            padding: "10px 18px",
            borderRadius: 8,
            border: `1px solid ${theme.primary}`,
            background: theme.primary,
            color: theme.onPrimary,
            cursor: "pointer",
            fontSize: 14,
            fontWeight: 600,
            whiteSpace: "nowrap",
          }}
        >
          ▶ Start execution
        </button>
      </div>
      {!hydrated ? (
        <p style={{ color: theme.textMuted }}>Loading…</p>
      ) : runs.length === 0 ? (
        <p style={{ color: theme.textMuted, marginTop: 24 }}>
          No runs yet. Click <strong>Start execution</strong> to kick one off.
        </p>
      ) : (  
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 16 }}>
          {[...runs]
            .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
            .map((run) => {
            const summary = summarizeRun(run, store.listEvents(run.id));
            return (
              <div
                key={run.id}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedRunId(run.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelectedRunId(run.id);
                  }
                }}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 110px 90px 110px 100px 90px",
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
                {run.status === "running" ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleStop(run);
                    }}
                    title="Stop this run"
                    style={{
                      padding: "6px 10px",
                      borderRadius: 6,
                      border: `1px solid ${theme.danger}`,
                      background: theme.codeBg,
                      color: theme.danger,
                      cursor: "pointer",
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    ◼ Stop
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRerun(run);
                    }}
                    title="Rerun this flow"
                    style={{
                      padding: "6px 10px",
                      borderRadius: 6,
                      border: `1px solid ${theme.border}`,
                      background: theme.codeBg,
                      color: theme.primary,
                      cursor: "pointer",
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    ↻ Rerun
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {newRunOpen && (
        <NewRunDialog onCancel={() => setNewRunOpen(false)} onStart={handleStart} />
      )}
    </div>
  );
}
