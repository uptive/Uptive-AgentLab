import { useEffect, useMemo, useState } from "react";
import type { ChangeType, EvaluationResult, Recommendation, RecommendationCategory, RecommendationChange } from "@agentlab/contracts";
import { CATEGORIES, analyzeRun, getModel, type EvaluationInput } from "@agentlab/optimization";
import { runSource, type RunSummary } from "../optimize/runSource.js";
import "./OptimizeView.css";

const CATEGORY_LABELS: Record<RecommendationCategory, string> = {
  quality: "Quality",
  "model-selection": "Model selection",
  "token-context": "Token & context",
  "flow-design": "Flow design",
};

const CHANGE_LABELS: Record<ChangeType, string> = {
  "set-model": "Model change",
  "remove-input": "Input trimming",
  "replace-input": "Input trimming",
  "add-output-schema": "Output schema",
  "edit-instructions": "Instructions",
  "extend-run-input": "Run input",
  "set-dependencies": "Dependency change",
  "add-node": "New step",
  "merge-nodes": "Merge steps",
  "edit-role": "Role change",
};

export function OptimizeView() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string>("");
  const [input, setInput] = useState<EvaluationInput>();
  const [result, setResult] = useState<EvaluationResult>();
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string>();
  const [categoryFilter, setCategoryFilter] = useState<RecommendationCategory>();
  const [nodeFilter, setNodeFilter] = useState<string>();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    runSource.listRuns().then((list) => {
      setRuns(list);
      setSelectedRunId((current) => current || list[0]?.runId || "");
    });
  }, []);

  async function handleAnalyze() {
    setAnalyzing(true);
    setError(undefined);
    setCategoryFilter(undefined);
    setNodeFilter(undefined);
    try {
      const loaded = await runSource.loadRun(selectedRunId);
      if (!loaded) throw new Error(`Run ${selectedRunId} was not found. Pick another run.`);
      const evaluation = await analyzeRun(loaded);
      setInput(loaded);
      setResult(evaluation);
      setExpanded(new Set());
    } catch (e) {
      setResult(undefined);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAnalyzing(false);
    }
  }

  function toggleExpanded(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function focusRecommendation(id: string) {
    setCategoryFilter(undefined);
    setNodeFilter(undefined);
    setExpanded((current) => new Set(current).add(id));
    requestAnimationFrame(() => document.getElementById(`rec-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }

  const visible = useMemo(
    () =>
      (result?.recommendations ?? []).filter(
        (r) => (!categoryFilter || r.category === categoryFilter) && (!nodeFilter || (r.target.kind === "node" && r.target.nodeId === nodeFilter)),
      ),
    [result, categoryFilter, nodeFilter],
  );

  return (
    <div className="opt">
      <header className="opt-header">
        <div>
          <h1>Optimize</h1>
          <p className="opt-lede">
            Evaluators review a finished run: the agents, what each step was given, and how the flow is wired. They suggest what to change
            and estimate what you would gain.
          </p>
        </div>
        <div className="opt-controls">
          <select className="opt-select" aria-label="Run to analyze" value={selectedRunId} onChange={(e) => setSelectedRunId(e.target.value)}>
            {runs.length === 0 ? <option value="">No finished runs yet</option> : null}
            {runs.map((run) => (
              <option key={run.runId} value={run.runId}>
                {run.label}
              </option>
            ))}
          </select>
          <button className="opt-primary" onClick={handleAnalyze} disabled={!selectedRunId || analyzing}>
            {analyzing ? "Analyzing…" : "Analyze run"}
          </button>
        </div>
      </header>

      {error ? <p className="opt-error">{error}</p> : null}
      {!result && !analyzing && !error ? <p className="opt-empty">Pick a run and analyze it to see what to change.</p> : null}

      {input && result ? (
        <>
          <Headline input={input} result={result} />
          {result.skippedEvaluators.map((s) => (
            <p key={s.evaluatorId} className="opt-notice">
              {CATEGORY_LABELS[s.category]} was not analyzed: {s.reason}
            </p>
          ))}

          <section className="opt-section">
            <div className="opt-section-head">
              <h2>Timeline</h2>
              <div className="opt-legend" aria-hidden="true">
                <span className="measured">Measured</span>
                <span className="projected">With all fixes</span>
              </div>
            </div>
            <Timeline input={input} result={result} selectedNodeId={nodeFilter} onSelectNode={(id) => setNodeFilter(id === nodeFilter ? undefined : id)} />
          </section>

          <FixFirst result={result} onSelect={focusRecommendation} />

          <section className="opt-section">
            <div className="opt-section-head">
              <h2>Recommendations</h2>
              <div className="opt-filters" role="group" aria-label="Filter by category">
                <button aria-pressed={!categoryFilter} onClick={() => setCategoryFilter(undefined)}>
                  All<span className="count">{result.recommendations.length}</span>
                </button>
                {CATEGORIES.map((category) => {
                  const count = result.summary.byCategory[category].count;
                  return (
                    <button
                      key={category}
                      aria-pressed={categoryFilter === category}
                      disabled={count === 0}
                      onClick={() => setCategoryFilter(categoryFilter === category ? undefined : category)}
                    >
                      {CATEGORY_LABELS[category]}
                      <span className="count">{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {nodeFilter ? (
              <p className="opt-node-filter">
                Showing <code>{nodeFilter}</code> only
                <button onClick={() => setNodeFilter(undefined)}>Show all steps</button>
              </p>
            ) : null}
            {visible.length === 0 ? <p className="opt-empty">No recommendations match this filter.</p> : null}

            {CATEGORIES.map((category) => {
              const group = visible.filter((r) => r.category === category);
              if (group.length === 0) return null;
              return (
                <div key={category} className="opt-group">
                  <div className="opt-group-head">
                    <h3>{CATEGORY_LABELS[category]}</h3>
                    <span className="totals">{categoryTotals(result, category)}</span>
                  </div>
                  <ul className="opt-list">
                    {group.map((r) => (
                      <RecommendationItem
                        key={r.id}
                        recommendation={r}
                        input={input}
                        expanded={expanded.has(r.id)}
                        onToggle={() => toggleExpanded(r.id)}
                      />
                    ))}
                  </ul>
                </div>
              );
            })}
          </section>
        </>
      ) : null}
    </div>
  );
}

function usd(value: number): string {
  return `$${Math.abs(value).toFixed(4)}`;
}

function seconds(ms: number): string {
  return `${(Math.abs(ms) / 1000).toFixed(1)}s`;
}

function signed(text: string, value: number): string {
  return `${value < 0 ? "−" : "+"}${text}`;
}

function percentChange(before: number, after: number): string {
  const percent = Math.round(((after - before) / before) * 100);
  return `${percent < 0 ? "−" : "+"}${Math.abs(percent)}%`;
}

function Impact({ recommendation }: { recommendation: Recommendation }) {
  const isRisk = !recommendation.estimatedImpact.cost && !recommendation.estimatedImpact.speed && !recommendation.estimatedImpact.reliability;
  return <span className={`opt-impact${isRisk ? " risk" : ""}`}>{headlineImpact(recommendation)}</span>;
}

/** The one number that best describes a recommendation: cost, then speed, then retries, then quality risk. */
function headlineImpact(r: Recommendation): string {
  const { cost, speed, reliability, quality } = r.estimatedImpact;
  if (cost) return `${cost.percent < 0 ? "−" : "+"}${Math.abs(cost.percent)}% cost`;
  if (speed) return `${signed(seconds(speed.latencyMs), speed.latencyMs)} run`;
  if (reliability) return `−${reliability.retriesAvoided} retr${reliability.retriesAvoided === 1 ? "y" : "ies"}`;
  if (quality) return `${quality.risk} risk`;
  return "";
}

function categoryTotals(result: EvaluationResult, category: RecommendationCategory): string {
  const { usdPerRun, latencyMs } = result.summary.byCategory[category];
  return [
    usdPerRun && usdPerRun < -0.00005 ? `${signed(usd(usdPerRun), usdPerRun)} per run` : undefined,
    latencyMs && latencyMs <= -100 ? `${signed(seconds(latencyMs), latencyMs)} run time` : undefined,
  ]
    .filter(Boolean)
    .join("  ·  ");
}

function targetLabel(r: Recommendation): string {
  return r.target.kind === "node" ? r.target.nodeId : r.target.kind === "agent" ? r.target.agentId : "whole flow";
}

function Headline({ input, result }: { input: EvaluationInput; result: EvaluationResult }) {
  const { baseline, projected } = result.summary;
  const usage = input.run.totalUsage;
  const figures = [
    { label: "Run time", before: seconds(baseline.latencyMs), after: seconds(projected.latencyMs), delta: percentChange(baseline.latencyMs, projected.latencyMs) },
    { label: "Cost per run", before: usd(baseline.costUsd), after: usd(projected.costUsd), delta: percentChange(baseline.costUsd, projected.costUsd) },
  ];
  return (
    <section className="opt-hero">
      <div className="opt-eyebrow">
        {input.flow.name} · <span className="mono">{input.run.id}</span>
      </div>
      <div className="opt-figures">
        {figures.map((f) => (
          <div key={f.label}>
            <div className="opt-figure-label">{f.label}</div>
            <div className="opt-figure-value">
              <span className="opt-figure-before">{f.before}</span>
              <span className="opt-figure-arrow" aria-label="becomes">
                →
              </span>
              <span className="opt-figure-after">{f.after}</span>
            </div>
            <div className="opt-figure-delta">{f.delta}</div>
          </div>
        ))}
      </div>
      <p className="opt-caption">
        Estimated if you apply all {result.recommendations.length} recommendations. Measured over {input.run.steps.length} steps
        {usage ? ` and ${(usage.inputTokens + usage.outputTokens).toLocaleString("en-US")} tokens` : ""}.
      </p>
    </section>
  );
}

/** One row per step: measured bar, and a mint outline where it would run with every fix applied. */
function Timeline({
  input,
  result,
  selectedNodeId,
  onSelectNode,
}: {
  input: EvaluationInput;
  result: EvaluationResult;
  selectedNodeId?: string;
  onSelectNode: (nodeId: string) => void;
}) {
  // Projected bars start on top of the measured ones, then slide to where the fixes would put them.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    setSettled(false);
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => setSettled(true)));
    return () => cancelAnimationFrame(frame);
  }, [result]);

  const { timeline } = result.summary;
  const spanMs = Math.max(...timeline.flatMap((t) => [t.measured.endMs, t.projected.endMs]));
  const pct = (ms: number) => `${(ms / spanMs) * 100}%`;
  const ticks = Array.from({ length: Math.floor(spanMs / 10_000) + 1 }, (_, i) => i * 10_000);

  return (
    <div className="opt-timeline">
      {timeline.map((t) => {
        const node = input.flow.nodes.find((n) => n.id === t.nodeId);
        const agent = input.agents.find((a) => a.id === node?.agentId);
        const count = result.recommendations.filter((r) => r.target.kind === "node" && r.target.nodeId === t.nodeId).length;
        const shown = settled ? t.projected : t.measured;
        return (
          <div key={t.nodeId} className="opt-tl-row">
            <div>
              <button
                className="opt-tl-label"
                aria-pressed={selectedNodeId === t.nodeId}
                onClick={() => onSelectNode(t.nodeId)}
                title="Show only this step's recommendations"
              >
                <span className="opt-tl-name">{agent?.name ?? t.nodeId}</span>
                <span className="opt-tl-model">{getModel(agent?.model ?? "")?.label ?? agent?.model}</span>
              </button>
            </div>
            <div
              className="opt-tl-track"
              role="img"
              aria-label={`${agent?.name ?? t.nodeId}: measured ${seconds(t.measured.startMs)} to ${seconds(t.measured.endMs)}, with all fixes ${seconds(t.projected.startMs)} to ${seconds(t.projected.endMs)}`}
            >
              <div className="opt-tl-bar measured" style={{ left: pct(t.measured.startMs), width: pct(t.measured.endMs - t.measured.startMs) }} />
              <div className="opt-tl-bar projected" style={{ left: pct(shown.startMs), width: pct(shown.endMs - shown.startMs) }} />
            </div>
            <div className="opt-tl-count">{count ? `${count} issue${count === 1 ? "" : "s"}` : ""}</div>
          </div>
        );
      })}
      <div className="opt-tl-axis" aria-hidden="true">
        {ticks.map((ms) => (
          <span key={ms} style={{ left: pct(ms) }}>
            {ms / 1000}s
          </span>
        ))}
      </div>
    </div>
  );
}

function FixFirst({ result, onSelect }: { result: EvaluationResult; onSelect: (id: string) => void }) {
  const top = result.summary.topRecommendationIds
    .map((id) => result.recommendations.find((r) => r.id === id))
    .filter((r): r is Recommendation => Boolean(r));
  if (top.length === 0) return null;
  return (
    <section className="opt-section">
      <div className="opt-section-head">
        <h2>Fix first</h2>
      </div>
      <ol className="opt-top">
        {top.map((r) => (
          <li key={r.id}>
            <button onClick={() => onSelect(r.id)}>
              <span className="opt-top-title">{withInlineCode(r.title)}</span>
              <span className="opt-top-meta">
                {CATEGORY_LABELS[r.category]} · <span className="mono">{targetLabel(r)}</span> · {r.severity} severity
              </span>
              <Impact recommendation={r} />
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

function RecommendationItem({
  recommendation: r,
  input,
  expanded,
  onToggle,
}: {
  recommendation: Recommendation;
  input: EvaluationInput;
  expanded: boolean;
  onToggle: () => void;
}) {
  const target = r.target;
  const agent = target.kind !== "flow" ? input.agents.find((a) => a.id === target.agentId) : undefined;
  const detailId = `rec-detail-${r.id}`;
  return (
    <li id={`rec-${r.id}`} className="opt-item">
      <button className="opt-row" aria-expanded={expanded} aria-controls={detailId} onClick={onToggle}>
        <span className={`opt-sev ${r.severity}`} title={`${r.severity} severity`} />
        <span className="opt-row-title">{withInlineCode(r.title)}</span>
        <span className="opt-node">{targetLabel(r)}</span>
        <Impact recommendation={r} />
        <svg className="opt-chevron" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <path d="M5 3l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {expanded ? (
        <dl id={detailId} className="opt-detail">
          <dt>Problem</dt>
          <dd>{withInlineCode(r.problem)}</dd>
          <dt>Change</dt>
          <dd>
            <ChangeDiff change={r.change} />
          </dd>
          <dt>Why</dt>
          <dd>{withInlineCode(r.suggestion)}</dd>
          <dt>Impact</dt>
          <dd className="impact">{r.estimatedImpact.summary}</dd>
          {r.evidence?.length ? (
            <>
              <dt>Evidence</dt>
              <dd>
                <ul>
                  {r.evidence.map((line) => (
                    <li key={line}>{withInlineCode(line)}</li>
                  ))}
                </ul>
              </dd>
            </>
          ) : null}
          <dd className="opt-detail-meta">
            {CHANGE_LABELS[r.change.type]} for {agent?.name ?? targetLabel(r)} · found by the {CATEGORY_LABELS[r.category].toLowerCase()} evaluator
          </dd>
        </dl>
      ) : null}
    </li>
  );
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "(none)";
  if (Array.isArray(value) && value.every((v) => typeof v === "string")) return `[${value.join(", ")}]`;
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function isInline(value: unknown): boolean {
  const text = formatValue(value);
  return text.length <= 60 && !text.includes("\n");
}

/** Before → after for a structured change: inline for short values, side by side for long ones. */
function ChangeDiff({ change }: { change: RecommendationChange }) {
  const path = <span className="opt-change-path">{change.path}</span>;
  if (isInline(change.before) && isInline(change.after)) {
    return (
      <>
        {path}
        <span className="opt-change-inline">
          <span className="before">{formatValue(change.before)}</span>
          <span aria-label="becomes">→</span>
          <span className="after">{change.after === null ? "(removed)" : formatValue(change.after)}</span>
        </span>
      </>
    );
  }
  return (
    <>
      {path}
      <div className="opt-change-blocks">
        <figure className="before">
          <figcaption>Before</figcaption>
          <pre>{formatValue(change.before)}</pre>
        </figure>
        <figure className="after">
          <figcaption>After</figcaption>
          <pre>{formatValue(change.after)}</pre>
        </figure>
      </div>
    </>
  );
}

/** Renders `backtick` spans from evaluator text as <code>. */
function withInlineCode(text: string) {
  return text.split(/`([^`]+)`/).map((part, i) => (i % 2 ? <code key={i}>{part}</code> : part));
}
