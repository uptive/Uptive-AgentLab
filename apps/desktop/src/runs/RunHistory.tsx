import { useState } from "react";
import type { Run, RunStatus } from "@agentlab/contracts";
import { getTelemetryStore, summarizeRun } from "@agentlab/observability";
import { theme } from "../theme.js";
import type { Catalog } from "./catalog.js";
import { formatMs, formatRelative, formatUsd } from "./format.js";
import { stopRun } from "./runLauncher.js";
import { EMPTY_RUN_FILTER, filterRuns, type RunFilter } from "./runLists.js";
import { StatusBadge, buttonStyle, fieldStyle, resolveRunFlow } from "./runUi.js";

const PAGE_SIZE = 50;
const STATUSES: (RunStatus | "all")[] = ["all", "running", "pending", "completed", "failed"];

function RunRow({
  run,
  catalog,
  onOpen,
  onRerun,
}: {
  run: Run;
  catalog: Catalog;
  onOpen: (runId: string) => void;
  onRerun: (run: Run) => void;
}) {
  const summary = summarizeRun(run, getTelemetryStore().listEvents(run.id));
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(run.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(run.id);
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
      <span style={{ fontSize: 13 }}>{(summary.inputTokens + summary.outputTokens).toLocaleString()} tok</span>
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
            onRerun(run);
          }}
          title="Rerun with the same input"
          style={{ ...buttonStyle("secondary"), padding: "6px 10px", fontSize: 12 }}
        >
          ↻ Rerun
        </button>
      )}
    </div>
  );
}

/** Every run, newest first, filterable by status, flow and name. */
export function RunHistory({
  runs,
  catalog,
  onOpen,
  onRerun,
}: {
  runs: Run[];
  catalog: Catalog;
  onOpen: (runId: string) => void;
  onRerun: (run: Run) => void;
}) {
  const [filter, setFilter] = useState<RunFilter>(EMPTY_RUN_FILTER);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const flowName = (run: Run) => resolveRunFlow(run, catalog).name;
  const flowOptions = [...new Map(runs.map((run) => [run.flowId, flowName(run)])).entries()].sort((a, b) =>
    a[1].localeCompare(b[1]),
  );
  const matching = filterRuns(runs, filter, flowName);
  const update = (patch: Partial<RunFilter>) => {
    setFilter((prev) => ({ ...prev, ...patch }));
    setLimit(PAGE_SIZE);
  };

  if (runs.length === 0) {
    return (
      <p style={{ color: theme.textMuted, margin: 0 }}>
        No runs yet. Click <strong>Start execution</strong> to kick one off.
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "grid", gridTemplateColumns: "150px 220px 1fr", gap: 8, marginBottom: 4 }}>
        <select
          aria-label="Filter by status"
          value={filter.status}
          onChange={(e) => update({ status: STATUSES.find((s) => s === e.target.value) ?? "all" })}
          style={fieldStyle}
        >
          {STATUSES.map((status) => (
            <option key={status} value={status}>
              {status === "all" ? "All statuses" : status}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by flow"
          value={filter.flowId}
          onChange={(e) => update({ flowId: e.target.value })}
          style={fieldStyle}
        >
          <option value="all">All flows and agents</option>
          {flowOptions.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <input
          type="search"
          placeholder="Search by name or run id"
          value={filter.query}
          onChange={(e) => update({ query: e.target.value })}
          style={fieldStyle}
        />
      </div>
      {matching.length === 0 ? (
        <p style={{ color: theme.textMuted }}>No runs match these filters.</p>
      ) : (
        matching
          .slice(0, limit)
          .map((run) => <RunRow key={run.id} run={run} catalog={catalog} onOpen={onOpen} onRerun={onRerun} />)
      )}
      {matching.length > limit ? (
        <button
          type="button"
          onClick={() => setLimit((prev) => prev + PAGE_SIZE)}
          style={{ ...buttonStyle("secondary"), alignSelf: "center" }}
        >
          Show more ({matching.length - limit} left)
        </button>
      ) : null}
    </div>
  );
}
