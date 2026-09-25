import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import type { FlowDefinition, Run } from "@agentlab/contracts";
import { getTelemetryStore } from "@agentlab/observability";
import { validateFlow } from "@agentlab/flow-engine";
import { theme } from "../theme.js";
import { useCatalog, type Catalog } from "../runs/catalog.js";
import { singleAgentFlow, startRun } from "../runs/runLauncher.js";
import { canRunForReal, connectLiveRuns } from "../liveRuns.js";
import { RunDetail } from "../runs/RunDetail.js";
import { LiveRuns } from "../runs/LiveRuns.js";
import { RunHistory } from "../runs/RunHistory.js";
import { activeRuns, countActiveRuns } from "../runs/runLists.js";
import { buttonStyle, fieldStyle, resolveRunFlow, resolveRunInput, useRuns } from "../runs/runUi.js";
import { clearOpenRunRequest, useOpenRunRequest } from "../notifications/bridge.js";
import { InputForm } from "../runs/InputForm.js";
import { buildInputForm, collectInput, firstAgent, formValuesFromInput, type FormObject } from "../runs/inputSchemaForm.js";

type RunsTab = "live" | "history";

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
  const [editAsJson, setEditAsJson] = useState(false);
  const [formValues, setFormValues] = useState<FormObject>({});
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
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

  const inputAgent = chosen ? firstAgent(chosen, (id) => catalog.agentsById.get(id)) : undefined;
  const inputForm = useMemo(() => buildInputForm(inputAgent?.inputSchema), [inputAgent?.inputSchema]);
  const showForm = inputForm !== undefined && !editAsJson;

  // A different first agent means a different form; start from its schema defaults.
  useEffect(() => {
    setFormValues(inputForm?.initialValues ?? {});
    setFormErrors({});
    setEditAsJson(false);
  }, [inputForm]);

  const toggleJson = () => {
    if (!inputForm) return;
    if (!editAsJson) {
      const collected = collectInput(inputForm.fields, formValues);
      if (collected.ok) setInputText(JSON.stringify(collected.value, null, 2));
    } else if (inputText.trim()) {
      // Carry JSON edits back into the form; stay on the JSON view if it doesn't parse.
      try {
        setFormValues(formValuesFromInput(inputForm.fields, JSON.parse(inputText)));
        setFormErrors({});
      } catch {
        setError("Input must be valid JSON to switch back to the form.");
        return;
      }
    }
    setError(undefined);
    setEditAsJson(!editAsJson);
  };

  const submit = () => {
    if (!chosen || !canStart) return;
    let parsed: unknown = undefined;
    const trimmed = inputText.trim();
    if (showForm) {
      const collected = collectInput(inputForm.fields, formValues);
      if (!collected.ok) {
        setFormErrors(collected.errors);
        return;
      }
      parsed = collected.value;
    } else if (trimmed.length > 0) {
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
          width: 560,
          maxWidth: "90vw",
          maxHeight: "90vh",
          overflowY: "auto",
          boxSizing: "border-box",
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

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 16 }}>
          <label style={labelStyle}>{showForm ? `Input for ${inputAgent?.name ?? "the first agent"}` : "Input (JSON)"}</label>
          {inputForm && (
            <button
              type="button"
              onClick={toggleJson}
              style={{ background: "none", border: "none", padding: 0, color: theme.primary, cursor: "pointer", fontSize: 12 }}
            >
              {editAsJson ? "Use form" : "Edit as JSON"}
            </button>
          )}
        </div>
        {showForm ? (
          <InputForm
            fields={inputForm.fields}
            values={formValues}
            errors={formErrors}
            fieldStyle={fieldStyle}
            onChange={(values, changedPath) => {
              setFormValues(values);
              // Clear errors on the edited field and anything nested under it.
              setFormErrors((current) =>
                Object.fromEntries(Object.entries(current).filter(([path]) => path !== changedPath && !path.startsWith(`${changedPath}.`))),
              );
              setError(undefined);
            }}
          />
        ) : (
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
        )}
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
  // Open on Live when something is executing, otherwise on the history.
  const [tab, setTab] = useState<RunsTab>(() => (countActiveRuns(store.listRuns()) > 0 ? "live" : "history"));
  const activeCount = countActiveRuns(runs);

  const resolveAgent = useCallback((agentId: string) => catalog.agentsById.get(agentId), [catalog]);

  // Opened from a notification or the tray: a run opens on the tab it belongs to (so Back returns
  // there), and a digest ("3 runs finished") opens the history.
  const openRequest = useOpenRunRequest();
  useEffect(() => {
    if (!openRequest) return;
    const { runId } = openRequest;
    const live = runId !== undefined && activeRuns(store.listRuns()).some((run) => run.id === runId);
    setTab(live ? "live" : "history");
    setSelectedRunId(runId);
    clearOpenRunRequest();
  }, [openRequest, store]);

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
      if (cancelled) return;
      setHydrated(true);
      if (countActiveRuns(store.listRuns()) > 0) setTab("live");
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
        backLabel={tab === "live" ? "Live runs" : "Run history"}
        onBack={() => setSelectedRunId(undefined)}
        onRerun={handleRerun}
      />
    );
  }

  const tabButton = (id: RunsTab, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === id}
      onClick={() => setTab(id)}
      style={{
        padding: "8px 14px",
        border: "none",
        borderBottom: `2px solid ${tab === id ? theme.primary : "transparent"}`,
        background: "transparent",
        color: tab === id ? theme.text : theme.textMuted,
        fontWeight: tab === id ? 600 : 400,
        fontSize: 14,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );

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
            Follow what is running now, or look back at earlier flow and agent executions.
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
      <div role="tablist" style={{ display: "flex", borderBottom: `1px solid ${theme.border}`, margin: "12px 0 16px" }}>
        {tabButton("live", activeCount > 0 ? `Live (${activeCount})` : "Live")}
        {tabButton("history", "History")}
      </div>
      {!hydrated ? (
        <p style={{ color: theme.textMuted }}>Loading…</p>
      ) : tab === "live" ? (
        <LiveRuns runs={runs} catalog={catalog} onOpen={setSelectedRunId} />
      ) : (
        <RunHistory runs={runs} catalog={catalog} onOpen={setSelectedRunId} onRerun={handleRerun} />
      )}
      {newRunOpen && (
        <NewRunDialog catalog={catalog} onCancel={() => setNewRunOpen(false)} onStart={handleStart} />
      )}
    </div>
  );
}
