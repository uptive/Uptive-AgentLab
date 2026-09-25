import { useCallback, useEffect, useState, useSyncExternalStore, type CSSProperties } from "react";
import type { AgentDefinition, FlowDefinition, Run, RunStatus, StepRun, TraceEvent } from "@agentlab/contracts";
import { getTelemetryStore, summarizeRun } from "@agentlab/observability";
import { findFlow, validateFlow } from "@agentlab/flow-engine";
import { theme } from "../theme.js";
import { useCatalog, type Catalog } from "../runs/catalog.js";
import { formatMs, formatRelative, formatUsd, stepLatencyMs } from "../runs/format.js";
import { RunGraph } from "../runs/RunGraph.js";
import { singleAgentFlow, startRun, stopRun } from "../runs/runLauncher.js";
import { buildActivity, canRunForReal, connectLiveRuns, useLiveStep } from "../liveRuns.js";
import { ActivityView } from "../runs/ActivityView.js";
import { JsonView } from "../runs/JsonView.js";

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

function Metric({ label, value, size = 18 }: { label: string; value: string; size?: number }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 12, color: theme.textMuted }}>{label}</div>
      <div style={{ fontSize: size, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>{value}</div>
    </div>
  );
}

function SectionLabel({ children }: { children: string }) {
  return <div style={{ fontSize: 12, color: theme.textMuted, margin: "16px 0 4px" }}>{children}</div>;
}

const buttonStyle = (variant: "primary" | "secondary" | "danger"): CSSProperties => ({
  padding: "8px 14px",
  borderRadius: 6,
  border: `1px solid ${variant === "primary" ? theme.primary : variant === "danger" ? theme.danger : theme.border}`,
  background: variant === "primary" ? theme.primary : theme.codeBg,
  color: variant === "primary" ? theme.onPrimary : variant === "danger" ? theme.danger : theme.primary,
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
  whiteSpace: "nowrap",
});

const fieldStyle: CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  background: theme.codeBg,
  color: theme.text,
  border: `1px solid ${theme.border}`,
  borderRadius: 6,
  fontSize: 14,
  boxSizing: "border-box",
};

/** Re-renders every `intervalMs` while `active`, so live durations keep counting. */
function useNow(active: boolean, intervalMs = 200): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs]);
  return active ? now : Date.now();
}

/** The flow a run executed: its own snapshot, a known flow, or a flat graph rebuilt from its steps. */
function resolveRunFlow(run: Run, catalog: Catalog): FlowDefinition {
  return (
    run.flow ??
    findFlow(run.flowId, catalog.flows.map((option) => option.flow)) ?? {
      id: run.flowId,
      name: run.flowId,
      nodes: run.steps.map((step) => ({ id: step.nodeId, agentId: step.agentId, dependsOn: [] })),
    }
  );
}

/** The input a run was started with, for reruns. Older runs only have it in their trace. */
function resolveRunInput(run: Run, events: TraceEvent[]): unknown {
  if (run.input !== undefined) return run.input;
  const flowStart = events.find((event) => event.type === "flow_start")?.data as { input?: unknown } | undefined;
  return flowStart?.input ?? run.steps[0]?.input;
}

/** The step's result, front and centre: text as text, structured output as expanded JSON. */
function FinalAnswer({ step }: { step: StepRun }) {
  const done = step.status === "completed";
  const output = step.output;
  return (
    <div
      style={{
        marginTop: 16,
        border: `1px solid ${done ? theme.statusActive : theme.border}`,
        borderRadius: 8,
        padding: 12,
        background: theme.surface,
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: done ? theme.statusActive : theme.textMuted, marginBottom: 8 }}>
        Final answer
      </div>
      {step.status === "running" ? (
        <div style={{ fontSize: 13, color: theme.textMuted }}>The agent is still working. Its answer appears here when it finishes; follow along below.</div>
      ) : step.status === "failed" ? (
        <div style={{ fontSize: 13, color: theme.errorText }}>No answer: {step.error ?? "the step failed."}</div>
      ) : typeof output === "string" ? (
        <div style={{ whiteSpace: "pre-wrap", fontSize: 14, lineHeight: 1.6, color: theme.text }}>{output}</div>
      ) : (
        <JsonView value={output} openDepth={3} maxHeight={520} />
      )}
    </div>
  );
}

function StepPanel({
  step,
  agent,
  label,
  context,
  now,
  onClose,
}: {
  step: StepRun;
  agent: AgentDefinition | undefined;
  label: string;
  context: { agentName: string; output: unknown }[];
  now: number;
  onClose: () => void;
}) {
  const usage = step.usage;
  const latencyMs = usage?.latencyMs ?? stepLatencyMs(step, now);
  const store = getTelemetryStore();
  const events = useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.listEvents(step.runId),
  );
  const live = useLiveStep(step.id);
  const running = step.status === "running";
  const activity = buildActivity(step.id, events, live);
  // Final usage once the step is done; while it runs, the token counts streamed so far.
  const inputTokens = usage?.inputTokens ?? live?.inputTokens;
  const outputTokens = usage?.outputTokens ?? live?.outputTokens;
  const [showInput, setShowInput] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const counts = {
    thinking: activity.filter((b) => b.kind === "thinking").length,
    tools: activity.filter((b) => b.kind === "tool_use").length,
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <strong style={{ fontSize: 16 }}>{label}</strong>
          <div style={{ fontSize: 12, color: theme.textMuted }}>
            {agent?.role ?? step.agentId} · {agent?.model ?? "unknown model"}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <StatusBadge status={step.status} />
          <button
            onClick={onClose}
            aria-label="Close agent details"
            style={{ background: "none", border: "none", color: theme.textMuted, cursor: "pointer", fontSize: 14 }}
          >
            ✕
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 16 }}>
        <Metric label={step.status === "running" ? "Latency (so far)" : "Latency"} value={formatMs(latencyMs)} size={16} />
        <Metric label="Cost" value={usage ? formatUsd(usage.estimatedCostUsd) : "-"} size={16} />
        <Metric label={running ? "Input tokens (so far)" : "Input tokens"} value={inputTokens !== undefined ? inputTokens.toLocaleString() : "-"} size={16} />
        <Metric label={running ? "Output tokens (so far)" : "Output tokens"} value={outputTokens !== undefined ? outputTokens.toLocaleString() : "-"} size={16} />
      </div>
      {step.startedAt ? (
        <div style={{ fontSize: 12, color: theme.textMuted, marginTop: 8 }}>
          Started {new Date(step.startedAt).toLocaleTimeString()}
          {step.completedAt ? ` · finished ${new Date(step.completedAt).toLocaleTimeString()}` : ""}
        </div>
      ) : null}

      {step.error ? (
        <div
          style={{
            marginTop: 12,
            padding: 10,
            borderRadius: 6,
            background: theme.errorBg,
            color: theme.errorText,
            fontSize: 12,
          }}
        >
          {step.error}
        </div>
      ) : null}

      {step.status === "pending" ? (
        <p style={{ fontSize: 12, color: theme.textMuted, marginTop: 16 }}>
          Waiting for upstream steps to finish — input and output appear once this agent starts.
        </p>
      ) : (
        <>
          <FinalAnswer step={step} />

          {running ? (
            <>
              <SectionLabel>Live activity</SectionLabel>
              <ActivityView blocks={activity} running />
            </>
          ) : activity.length > 0 ? (
            <div style={{ marginTop: 16 }}>
              <button
                type="button"
                onClick={() => setShowActivity((v) => !v)}
                style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 12, fontWeight: 600, color: theme.textSecondary }}
              >
                {showActivity ? "▾" : "▸"} What the agent did
                <span style={{ fontWeight: 400, color: theme.textMuted }}>
                  {" "}
                  · {counts.thinking} thinking · {counts.tools} tool {counts.tools === 1 ? "call" : "calls"}
                </span>
              </button>
              {showActivity ? (
                <div style={{ marginTop: 8 }}>
                  <ActivityView blocks={activity} running={false} />
                </div>
              ) : null}
            </div>
          ) : null}
          <div style={{ marginTop: 16 }}>
            <button
              type="button"
              onClick={() => setShowInput((v) => !v)}
              style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 12, fontWeight: 600, color: theme.textSecondary }}
            >
              {showInput ? "▾" : "▸"} Input
            </button>
            {showInput ? (
              <div style={{ marginTop: 6 }}>
                <JsonView value={step.input} />
              </div>
            ) : null}
          </div>
        </>
      )}

      {step.toolCalls.length > 0 && activity.length === 0 ? (
        <>
          <SectionLabel>Tool calls</SectionLabel>
          {step.toolCalls.map((call, index) => (
            <div key={index} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 12, marginBottom: 4 }}>
                <strong>{call.toolId}</strong> (
                {formatMs(new Date(call.completedAt).getTime() - new Date(call.startedAt).getTime())})
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 8 }}>
                <JsonView value={call.input} openDepth={1} />
                <JsonView value={call.output} openDepth={1} />
              </div>
            </div>
          ))}
        </>
      ) : null}

      {context.length > 0 ? (
        <>
          <SectionLabel>Context from previous steps</SectionLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {context.map((entry, index) => (
              <div key={index}>
                <div style={{ fontSize: 12, marginBottom: 2 }}>
                  <strong>{entry.agentName}</strong>
                </div>
                <JsonView value={entry.output ?? null} openDepth={1} />
              </div>
            ))}
          </div>
        </>
      ) : null}

      {agent?.systemInstructions ? (
        <>
          <SectionLabel>System instructions</SectionLabel>
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
        </>
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

function RunDetail({
  run,
  catalog,
  onBack,
  onRerun,
}: {
  run: Run;
  catalog: Catalog;
  onBack: () => void;
  onRerun: (run: Run) => void;
}) {
  const store = getTelemetryStore();
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>(undefined);
  const live = run.status === "running";
  const now = useNow(live);
  const summary = summarizeRun(run, store.listEvents(run.id));
  const flow = resolveRunFlow(run, catalog);
  const stepByNodeId = new Map(run.steps.map((step) => [step.nodeId, step]));
  const agentName = (agentId: string) => catalog.agentsById.get(agentId)?.name ?? agentId;

  const completedSteps = run.steps.filter((step) => step.status === "completed").length;
  const runningSteps = run.steps.filter((step) => step.status === "running");
  const durationMs = summary.durationMs ?? (live ? now - new Date(run.startedAt).getTime() : undefined);

  const selectedNode = flow.nodes.find((node) => node.id === selectedNodeId);
  const selectedStep = selectedNodeId ? stepByNodeId.get(selectedNodeId) : undefined;
  const selectedAgent = selectedStep ? catalog.agentsById.get(selectedStep.agentId) : undefined;
  const selectedLabel = selectedNode?.label ?? (selectedStep ? agentName(selectedStep.agentId) : "");
  const stepContext = selectedNode
    ? selectedNode.dependsOn.flatMap((depId) => {
        const parent = stepByNodeId.get(depId);
        return parent?.output !== undefined ? [{ agentName: agentName(parent.agentId), output: parent.output }] : [];
      })
    : [];

  const crumbs = [
    { label: "All runs", onClick: onBack },
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
        <Metric label="Progress" value={`${completedSteps} / ${run.steps.length} steps`} />
        <Metric label={live ? "Elapsed" : "Duration"} value={formatMs(durationMs)} />
        <Metric label="Total tokens" value={(summary.inputTokens + summary.outputTokens).toLocaleString()} />
        <Metric label="Estimated cost" value={formatUsd(summary.estimatedCostUsd)} />
        {live ? (
          <Metric
            label="Running now"
            value={runningSteps.length > 0 ? runningSteps.map((step) => agentName(step.agentId)).join(", ") : "-"}
          />
        ) : null}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: selectedStep ? "minmax(0, 1fr) 400px" : "minmax(0, 1fr)",
          gap: 16,
          flex: 1,
          minHeight: 420,
        }}
      >
        <div
          style={{
            position: "relative",
            borderRadius: 8,
            overflow: "hidden",
            border: `1px solid ${theme.border}`,
          }}
        >
          <RunGraph
            flow={flow}
            run={run}
            agentsById={catalog.agentsById}
            selectedNodeId={selectedNodeId}
            onSelectNode={setSelectedNodeId}
            now={now}
          />
          {!selectedStep ? (
            <div
              style={{
                position: "absolute",
                top: 10,
                left: 12,
                fontSize: 12,
                color: "#fdfdfdaa",
                pointerEvents: "none",
              }}
            >
              Click an agent to see its input, output, tokens, cost and latency.
            </div>
          ) : null}
        </div>
        {selectedStep ? (
          <div
            style={{
              background: theme.surface,
              border: `1px solid ${theme.border}`,
              borderRadius: 8,
              padding: 16,
              overflow: "auto",
            }}
          >
            <StepPanel
              step={selectedStep}
              agent={selectedAgent}
              label={selectedLabel}
              context={stepContext}
              now={now}
              onClose={() => setSelectedNodeId(undefined)}
            />
          </div>
        ) : null}
      </div>
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

type RunTarget = "flow" | "agent";

/** Shown in place of a picker when nothing has been created yet. */
function EmptyCatalog({ what, tab }: { what: string; tab: string }) {
  return (
    <div style={{ fontSize: 13, color: theme.textMuted }}>
      No {what} yet.{" "}
      <button
        type="button"
        onClick={() => window.dispatchEvent(new CustomEvent("agentlab:navigate", { detail: tab }))}
        style={{ background: "none", border: "none", padding: 0, color: theme.primary, cursor: "pointer", fontSize: 13 }}
      >
        Create one
      </button>
    </div>
  );
}

function NewRunDialog({
  catalog,
  onCancel,
  onStart,
}: {
  catalog: Catalog;
  onCancel: () => void;
  onStart: (flow: FlowDefinition, input: unknown, folder?: string) => Promise<void>;
}) {
  const [folder, setFolder] = useState<string | undefined>(undefined);
  const [starting, setStarting] = useState(false);
  const [target, setTarget] = useState<RunTarget>("flow");
  const [flowId, setFlowId] = useState<string>(catalog.flows[0]?.flow.id ?? "");
  const [agentId, setAgentId] = useState<string>(catalog.agents[0]?.id ?? "");
  const [inputText, setInputText] = useState<string>("");
  const [error, setError] = useState<string | undefined>(undefined);

  // The catalog loads after the dialog opens, so pick the first entry once there is one.
  useEffect(() => {
    if (!catalog.flows.some((option) => option.flow.id === flowId)) setFlowId(catalog.flows[0]?.flow.id ?? "");
    if (!catalog.agentsById.has(agentId)) setAgentId(catalog.agents[0]?.id ?? "");
  }, [catalog, flowId, agentId]);

  const flow = catalog.flows.find((option) => option.flow.id === flowId)?.flow;
  const agent = catalog.agentsById.get(agentId);
  const chosen = target === "flow" ? flow : agent ? singleAgentFlow(agent) : undefined;
  const validation = chosen ? validateFlow(chosen, { knownAgentIds: catalog.agentsById.keys() }) : undefined;
  const problems = validation?.errors.map((issue) => issue.message) ?? [];
  const canStart = chosen !== undefined && problems.length === 0;

  const submit = () => {
    if (!chosen || !canStart) return;
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
    setStarting(true);
    onStart(chosen, parsed, folder)
      .catch((err) => setError((err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, "")))
      .finally(() => setStarting(false));
  };

  const tab = (value: RunTarget, label: string) => (
    <button
      type="button"
      onClick={() => setTarget(value)}
      style={{
        flex: 1,
        padding: "6px 10px",
        border: "none",
        borderRadius: 5,
        background: target === value ? theme.surface : "transparent",
        color: target === value ? theme.text : theme.textMuted,
        fontWeight: target === value ? 600 : 400,
        boxShadow: target === value ? theme.cardShadow : "none",
        cursor: "pointer",
        fontSize: 13,
      }}
    >
      {label}
    </button>
  );

  const labelStyle: CSSProperties = { display: "block", fontSize: 12, color: theme.textMuted, marginBottom: 6 };

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
          Run a whole flow or a single agent. You'll be taken to the live run as soon as it starts.
        </p>

        <div
          style={{
            display: "flex",
            gap: 4,
            padding: 3,
            marginBottom: 16,
            borderRadius: 8,
            background: theme.codeBg,
            border: `1px solid ${theme.border}`,
          }}
        >
          {tab("flow", "Flow")}
          {tab("agent", "Single agent")}
        </div>

        {target === "flow" ? (
          <>
            <label style={labelStyle}>Flow</label>
            {catalog.loading || catalog.flows.length > 0 ? (
              <>
                <select value={flowId} onChange={(e) => setFlowId(e.target.value)} style={fieldStyle}>
                  {catalog.flows.map((option) => (
                    <option key={option.flow.id} value={option.flow.id}>
                      {option.flow.name} ({option.flow.nodes.length} steps · {option.source})
                    </option>
                  ))}
                </select>
                <div style={{ fontSize: 12, color: theme.textMuted, marginTop: 6 }}>
                  {catalog.loading ? "Loading project flows…" : flow?.description}
                </div>
              </>
            ) : (
              <EmptyCatalog what="flows" tab="flows" />
            )}
          </>
        ) : (
          <>
            <label style={labelStyle}>Agent</label>
            {catalog.loading || catalog.agents.length > 0 ? (
              <>
                <select value={agentId} onChange={(e) => setAgentId(e.target.value)} style={fieldStyle}>
                  {catalog.agents.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name} ({option.model})
                    </option>
                  ))}
                </select>
                <div style={{ fontSize: 12, color: theme.textMuted, marginTop: 6 }}>
                  {catalog.loading ? "Loading agents…" : agent?.description ?? agent?.role}
                </div>
              </>
            ) : (
              <EmptyCatalog what="agents" tab="agents" />
            )}
          </>
        )}

        {problems.length > 0 ? (
          <div style={{ color: theme.danger, fontSize: 12, marginTop: 8 }}>
            {problems.map((problem, index) => (
              <div key={index}>• {problem}</div>
            ))}
          </div>
        ) : null}

        <label style={{ ...labelStyle, marginTop: 16 }}>Input (JSON)</label>
        <textarea
          value={inputText}
          onChange={(e) => {
            setInputText(e.target.value);
            setError(undefined);
          }}
          rows={7}
          style={{
            ...fieldStyle,
            padding: 10,
            border: `1px solid ${error ? theme.danger : theme.border}`,
            fontFamily: theme.fontMono,
            fontSize: 12,
            resize: "vertical",
          }}
        />
        {error && <div style={{ color: theme.danger, fontSize: 12, marginTop: 6 }}>{error}</div>}

        {canRunForReal() && (
          <>
            <label style={{ ...labelStyle, marginTop: 16 }}>Folder agents may read (optional)</label>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <code style={{ flex: 1, fontSize: 12, color: folder ? theme.text : theme.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {folder ?? "None: agents only see the input above"}
              </code>
              <button type="button" onClick={() => void window.agentlab.runs.pickFolder().then((f) => f && setFolder(f))} style={{ ...buttonStyle("secondary"), color: theme.text }}>
                Choose…
              </button>
              {folder && (
                <button type="button" onClick={() => setFolder(undefined)} style={{ ...buttonStyle("secondary"), color: theme.text }}>
                  Clear
                </button>
              )}
            </div>
            <p style={{ fontSize: 12, color: theme.textMuted, marginBottom: 0 }}>
              Runs for real with Claude. Model calls count against your Claude subscription or API key.
            </p>
          </>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
          <button type="button" onClick={onCancel} style={{ ...buttonStyle("secondary"), color: theme.text }}>
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canStart || starting}
            style={{ ...buttonStyle("primary"), opacity: canStart && !starting ? 1 : 0.5, cursor: canStart && !starting ? "pointer" : "not-allowed" }}
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
  const catalog = useCatalog();
  const [selectedRunId, setSelectedRunId] = useState<string | undefined>(undefined);
  const [hydrated, setHydrated] = useState(false);
  const [newRunOpen, setNewRunOpen] = useState(false);

  const resolveAgent = useCallback((agentId: string) => catalog.agentsById.get(agentId), [catalog]);

  const handleStart = useCallback(
    async (flow: FlowDefinition, input: unknown, folder?: string) => {
      const runId = await startRun(flow, input, resolveAgent, folder);
      setNewRunOpen(false);
      setSelectedRunId(runId);
    },
    [resolveAgent],
  );

  const handleRerun = useCallback(
    (run: Run) => {
      const input = resolveRunInput(run, store.listEvents(run.id));
      handleStart(resolveRunFlow(run, catalog), input).catch((err) => console.error("Rerun failed to start:", err));
    },
    [store, catalog, handleStart],
  );

  useEffect(() => {
    connectLiveRuns();
    let cancelled = false;
    void store.hydrate().then(() => {
      if (!cancelled) setHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, [store]);

  const selectedRun = selectedRunId ? runs.find((run) => run.id === selectedRunId) : undefined;
  if (selectedRun) {
    return (
      <RunDetail
        key={selectedRun.id}
        run={selectedRun}
        catalog={catalog}
        onBack={() => setSelectedRunId(undefined)}
        onRerun={handleRerun}
      />
    );
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
            Recent flow and agent executions. Click a run to follow it live and inspect each agent.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setNewRunOpen(true)}
          style={{ ...buttonStyle("primary"), padding: "10px 18px", borderRadius: 8, fontSize: 14 }}
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
                    <strong>{resolveRunFlow(run, catalog).name}</strong>
                    <div style={{ fontSize: 12, color: theme.textMuted }}>
                      {formatRelative(run.startedAt)} · {run.steps.length} {run.steps.length === 1 ? "step" : "steps"}
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
                        stopRun(run);
                      }}
                      title="Stop this run"
                      style={{ ...buttonStyle("danger"), padding: "6px 10px", fontSize: 12 }}
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
                      title="Rerun with the same input"
                      style={{ ...buttonStyle("secondary"), padding: "6px 10px", fontSize: 12 }}
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
        <NewRunDialog catalog={catalog} onCancel={() => setNewRunOpen(false)} onStart={handleStart} />
      )}
    </div>
  );
}
