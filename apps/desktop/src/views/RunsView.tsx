import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { AgentDefinition, FlowDefinition, Run, RunStatus, StepRun } from "@agentlab/contracts";
import { getTelemetryStore, summarizeRun } from "@agentlab/observability";
import { computeFlowLayers, demoFlow } from "@agentlab/flow-engine";
import { theme } from "../theme.js";
import { demoRuns, demoTraceEvents } from "../demoRuns.js";
import { agentOf, canRunForReal, cancelRun, connectLiveRuns, flowOf, startRun } from "../liveRuns.js";

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
  const flow: FlowDefinition = flowOf(run);
  const layers = computeFlowLayers(flow);
  const selectedStep = run.steps.find((step) => step.id === selectedStepId);
  const selectedAgent = selectedStep ? agentOf(run, selectedStep.agentId) : undefined;
  const totalTokens = summary.inputTokens + summary.outputTokens;

  const stepByNodeId = new Map(run.steps.map((step) => [step.nodeId, step]));
  const agentsInRun = run.steps.map((step) => agentOf(run, step.agentId) ?? undefined);
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
          const parentAgent = agentOf(run, parentStep.agentId);
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
        {run.authSource ? ` · paid by ${run.authSource === "subscription" ? "Claude subscription" : run.authSource === "api-key" ? "API key" : "unknown"}` : ""}
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
              const agent = agentOf(run, node.agentId);
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

const DEMO_INPUT = {
  title: "Add user lookup endpoint",
  description: "Adds findUser so support can look users up by name.",
  diff: [
    "diff --git a/src/users.ts b/src/users.ts",
    "+export async function findUser(db, req) {",
    "+  const name = req.query.name;",
    "+  return db.query(\"SELECT * FROM users WHERE name = '\" + name + \"'\");",
    "+}",
  ].join("\n"),
};

const secondaryButton = {
  padding: "6px 12px",
  borderRadius: 6,
  border: `1px solid ${theme.border}`,
  background: "transparent",
  color: theme.text,
  cursor: "pointer",
  fontSize: 12,
} as const;

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, "");
}

/** The demo flow plus every flow saved in the Flows view (files and MongoDB). */
function useRunnableFlows(): FlowDefinition[] {
  const [flows, setFlows] = useState<FlowDefinition[]>([demoFlow]);
  useEffect(() => {
    if (!window.agentlab?.projects) return;
    let cancelled = false;
    void (async () => {
      const { flows: entries } = await window.agentlab.projects.list();
      const saved: FlowDefinition[] = [];
      for (const entry of entries.filter((e) => e.status === "ok" && (e.nodeCount ?? 0) > 0)) {
        try {
          saved.push(JSON.parse(await window.agentlab.flows.read(entry.filePath)) as FlowDefinition);
        } catch {
          // Unreadable flow file: the Flows view shows the problem.
        }
      }
      // Flows saved to MongoDB; skipped when the database is unreachable.
      const cloud = await window.agentlab.cloudFlows.list().catch(() => []);
      for (const { createdAt: _c, updatedAt: _u, ...flow } of cloud) if (flow.nodes.length > 0) saved.push(flow);
      const unique = new Map([demoFlow, ...saved].map((f) => [f.id, f]));
      if (!cancelled) setFlows([...unique.values()]);
    })().catch((error) => console.warn("Could not load saved flows:", error));
    return () => {
      cancelled = true;
    };
  }, []);
  return flows;
}

function NewRunDialog({
  onCancel,
  onStart,
}: {
  onCancel: () => void;
  onStart: (flow: FlowDefinition, input: unknown, folder?: string) => Promise<void>;
}) {
  const flows = useRunnableFlows();
  const [flowId, setFlowId] = useState<string>(demoFlow.id);
  const [inputText, setInputText] = useState<string>(JSON.stringify(DEMO_INPUT, null, 2));
  const [folder, setFolder] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [starting, setStarting] = useState(false);
  const flow = flows.find((f) => f.id === flowId) ?? flows[0];

  const submit = async () => {
    let parsed: unknown = undefined;
    const trimmed = inputText.trim();
    if (trimmed.length > 0) {
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        // Plain text is a valid task too.
        parsed = trimmed;
      }
    }
    setStarting(true);
    try {
      await onStart(flow, parsed, folder);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setStarting(false);
    }
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
          {flows.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        <div style={{ fontSize: 12, color: theme.textMuted, marginTop: -12, marginBottom: 16 }}>
          {flow.description}
        </div>

        <label style={{ display: "block", fontSize: 12, color: theme.textMuted, marginBottom: 6 }}>
          Input (JSON or plain text)
        </label>
        <textarea
          value={inputText}
          onChange={(e) => {
            setInputText(e.target.value);
            setError(undefined);
          }}
          rows={10}
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

        {canRunForReal() && (
          <>
            <label style={{ display: "block", fontSize: 12, color: theme.textMuted, margin: "16px 0 6px" }}>
              Folder agents may read (optional)
            </label>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <code style={{ flex: 1, fontSize: 12, color: folder ? theme.text : theme.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {folder ?? "None: agents only see the input above"}
              </code>
              <button type="button" onClick={() => void window.agentlab.runs.pickFolder().then((f) => f && setFolder(f))} style={secondaryButton}>
                Choose…
              </button>
              {folder && (
                <button type="button" onClick={() => setFolder(undefined)} style={secondaryButton}>
                  Clear
                </button>
              )}
            </div>
            <p style={{ fontSize: 12, color: theme.textMuted, marginBottom: 0 }}>
              Runs for real with Claude. Each step's model calls count against your Claude subscription or API key.
            </p>
          </>
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
            onClick={() => void submit()}
            disabled={starting}
            style={{
              opacity: starting ? 0.6 : 1,
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
            {starting ? "Starting…" : "▶ Run"}
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

  const [runError, setRunError] = useState<string | undefined>(undefined);

  const handleRerun = useCallback(
    (run: Run) => {
      if (run.flow && canRunForReal()) {
        // Real runs start again with the same flow snapshot and input.
        const input = store.listEvents(run.id).find((e) => e.type === "flow_start")?.data as { input?: unknown } | undefined;
        startRun(run.flow, input?.input).catch((error) => setRunError(errorText(error)));
        return;
      }
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
      if (run.flow && canRunForReal()) {
        void cancelRun(run.id); // the engine stops scheduling; running steps are aborted
        return;
      }
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
    async (flow: FlowDefinition, input: unknown, folder?: string) => {
      if (canRunForReal()) {
        const runId = await startRun(flow, input, folder); // throws into the dialog on failure
        setNewRunOpen(false);
        setSelectedRunId(runId);
        return;
      }
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
    connectLiveRuns();
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
                  <strong>{flowOf(run).id === run.flowId ? flowOf(run).name : run.flowId}</strong>
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
      {runError && (
        <div role="alert" style={{ marginTop: 12, color: theme.danger, fontSize: 13 }}>
          {runError}{" "}
          <button type="button" onClick={() => setRunError(undefined)} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer" }}>
            ✕
          </button>
        </div>
      )}
      {newRunOpen && (
        <NewRunDialog onCancel={() => setNewRunOpen(false)} onStart={handleStart} />
      )}
    </div>
  );
}
