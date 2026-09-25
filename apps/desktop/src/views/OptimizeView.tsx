import { useEffect, useRef, useState } from "react";
import {
  RECOMMENDATION_TAGS,
  type ChangeType,
  type EvaluationResult,
  type Recommendation,
  type RecommendationCategory,
  type RecommendationChange,
  type RecommendationTag,
} from "@agentlab/contracts";
import {
  CATEGORIES,
  DEFAULT_EVALUATOR_MODEL,
  EVALUATOR_MODELS,
  analyzeRun,
  createEvaluators,
  getModel,
  type EvaluationInput,
  type EvaluatorProgress,
  type ModelClient,
} from "@agentlab/optimization";
import { SeverityIcon, TagIcon, TagList } from "../optimize/badges.js";
import { modelClient } from "../optimize/modelClient.js";
import { runSource, type RunSummary } from "../optimize/runSource.js";
import { reportOptimizationFinished } from "../notifications/bridge.js";
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
  "edit-input-mapping": "Input mapping",
};

const DEFAULT_MODEL_KEY = "agentlab.optimize.defaultModel";

function loadDefaultModel(): string {
  try {
    const saved = localStorage.getItem(DEFAULT_MODEL_KEY);
    return EVALUATOR_MODELS.some((m) => m.id === saved) ? saved! : DEFAULT_EVALUATOR_MODEL;
  } catch {
    return DEFAULT_EVALUATOR_MODEL;
  }
}

function saveDefaultModel(modelId: string) {
  try {
    localStorage.setItem(DEFAULT_MODEL_KEY, modelId);
  } catch {
    // Storage unavailable: the choice lasts for this session only.
  }
}

const modelLabel = (modelId: string) => EVALUATOR_MODELS.find((m) => m.id === modelId)?.label ?? modelId;

/** Quality and Model Selection ask Claude on `modelId` (through Electron main); the others are rule-based. */
function evaluatorsFor(modelId: string) {
  const client: ModelClient = { generateJson: (request) => modelClient.generateJson({ ...request, model: modelId }) };
  return createEvaluators(client);
}

export function OptimizeView() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string>("");
  const [input, setInput] = useState<EvaluationInput>();
  const [result, setResult] = useState<EvaluationResult>();
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string>();
  const [categoryFilter, setCategoryFilter] = useState<RecommendationCategory>();
  const [tagFilter, setTagFilter] = useState<RecommendationTag>();
  const [nodeFilter, setNodeFilter] = useState<string>();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [defaultModel, setDefaultModel] = useState(loadDefaultModel);
  const [analyzingWith, setAnalyzingWith] = useState<string>();
  const [analyzedWith, setAnalyzedWith] = useState<string>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Live progress while analyzing: the run being reviewed, each evaluator's status, and a clock.
  const [pendingInput, setPendingInput] = useState<EvaluationInput>();
  const [progress, setProgress] = useState<Record<string, EvaluatorProgress & { finishedMs?: number }>>({});
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!analyzing) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [analyzing]);

  useEffect(() => {
    runSource.listRuns().then((list) => {
      setRuns(list);
      setSelectedRunId((current) => current || list[0]?.runId || "");
    });
  }, []);

  async function handleAnalyze(modelId: string) {
    setAnalyzing(true);
    setAnalyzingWith(modelId);
    setProgress({});
    setPendingInput(undefined);
    const started = Date.now();
    setStartedAt(started);
    setNow(started);
    setError(undefined);
    setCategoryFilter(undefined);
    setTagFilter(undefined);
    setNodeFilter(undefined);
    try {
      const loaded = await runSource.loadRun(selectedRunId);
      if (!loaded) throw new Error(`Run ${selectedRunId} was not found. Pick another run.`);
      setPendingInput(loaded);
      const evaluation = await analyzeRun(loaded, evaluatorsFor(modelId), {
        onProgress: (update) =>
          setProgress((current) => ({
            ...current,
            [update.evaluatorId]: { ...update, finishedMs: update.status === "running" ? undefined : Date.now() - started },
          })),
      });
      setInput(loaded);
      setResult(evaluation);
      setAnalyzedWith(modelId);
      setExpanded(new Set());
      // Main shows a notification only if the user switched to another app while this ran.
      reportOptimizationFinished({
        flowName: loaded.flow.name,
        recommendations: evaluation.recommendations.length,
        highSeverity: evaluation.recommendations.filter((r) => r.severity === "high").length,
        savedUsdPerRun: evaluation.summary.baseline.costUsd - evaluation.summary.projected.costUsd,
      }).catch((e: Error) => setError(`The analysis finished, but the notification could not be sent: ${e.message}`));
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
    setTagFilter(undefined);
    setNodeFilter(undefined);
    setExpanded((current) => new Set(current).add(id));
    requestAnimationFrame(() => document.getElementById(`rec-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }

  // Category and tag filters combine: each list counts what the other filter (and the step filter) leaves.
  const matchesNode = (r: Recommendation) => !nodeFilter || (r.target.kind === "node" && r.target.nodeId === nodeFilter);
  const matchesCategory = (r: Recommendation) => !categoryFilter || r.category === categoryFilter;
  const matchesTag = (r: Recommendation) => !tagFilter || (r.tags ?? []).includes(tagFilter);
  const all = result?.recommendations ?? [];
  const visible = all.filter((r) => matchesNode(r) && matchesCategory(r) && matchesTag(r));
  const categoryCount = (category: RecommendationCategory) => all.filter((r) => r.category === category && matchesNode(r) && matchesTag(r)).length;
  const tagCount = (tag: RecommendationTag) => all.filter((r) => (r.tags ?? []).includes(tag) && matchesNode(r) && matchesCategory(r)).length;
  const usedTags = RECOMMENDATION_TAGS.filter((tag) => all.some((r) => r.tags?.includes(tag)));

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
          <AnalyzeButton defaultModel={defaultModel} disabled={!selectedRunId || analyzing} analyzing={analyzing} onAnalyze={handleAnalyze} />
          <button className="opt-icon-button" aria-label="Optimize settings" title="Settings" onClick={() => setSettingsOpen(true)}>
            <GearIcon />
          </button>
        </div>
      </header>

      <SettingsDialog
        open={settingsOpen}
        defaultModel={defaultModel}
        onChangeDefaultModel={(modelId) => {
          setDefaultModel(modelId);
          saveDefaultModel(modelId);
        }}
        onClose={() => setSettingsOpen(false)}
      />

      {error ? <p className="opt-error">{error}</p> : null}
      {analyzing ? (
        <AnalysisProgress input={pendingInput} progress={progress} modelId={analyzingWith ?? defaultModel} elapsedMs={now - startedAt} />
      ) : null}
      {!result && !analyzing && !error ? <p className="opt-empty">Pick a run and analyze it to see what to change.</p> : null}

      {input && result && !analyzing ? (
        <>
          <Headline input={input} result={result} analyzedWith={analyzedWith} />
          {result.skippedEvaluators.map((s) => (
            <p key={s.evaluatorId} className="opt-notice">
              {CATEGORY_LABELS[s.category]} was not analyzed: {s.reason}
            </p>
          ))}
          {result.fallbackEvaluators.map((s) => (
            <p key={s.evaluatorId} className="opt-notice">
              {CATEGORY_LABELS[s.category]} used built-in rules because Claude was unavailable: {s.reason}
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
                  All<span className="count">{all.filter((r) => matchesNode(r) && matchesTag(r)).length}</span>
                </button>
                {CATEGORIES.map((category) => {
                  const count = categoryCount(category);
                  return (
                    <button
                      key={category}
                      aria-pressed={categoryFilter === category}
                      disabled={count === 0 && categoryFilter !== category}
                      onClick={() => setCategoryFilter(categoryFilter === category ? undefined : category)}
                    >
                      {CATEGORY_LABELS[category]}
                      <span className="count">{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {usedTags.length ? (
              <div className="opt-tag-filters" role="group" aria-label="Filter by tag">
                <span className="opt-tag-filters-label" aria-hidden="true">
                  Tags
                </span>
                {usedTags.map((tag) => {
                  const count = tagCount(tag);
                  return (
                    <button
                      key={tag}
                      aria-pressed={tagFilter === tag}
                      disabled={count === 0 && tagFilter !== tag}
                      onClick={() => setTagFilter(tagFilter === tag ? undefined : tag)}
                    >
                      <TagIcon tag={tag} />
                      {tag}
                      <span className="count">{count}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}

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
  const { text, gain } = headlineImpact(recommendation);
  const { quality } = recommendation.estimatedImpact;
  if (!text && quality) {
    // Only a quality risk to show: its level as an icon, not as "high risk" text.
    return (
      <span className="opt-impact risk">
        <SeverityIcon severity={quality.risk} label={`${quality.risk[0].toUpperCase()}${quality.risk.slice(1)} quality risk`} size={12} />
        <span aria-hidden="true">risk</span>
      </span>
    );
  }
  return <span className={`opt-impact${gain ? "" : " risk"}`}>{text}</span>;
}

/**
 * The one number that best describes a recommendation, leading with what you gain: a cost saving,
 * then time saved, then retries avoided. A cost increase or a quality risk is shown only when
 * there's no gain to show, and never in the gain color.
 */
function headlineImpact(r: Recommendation): { text: string; gain: boolean } {
  const { cost, speed, reliability, quality } = r.estimatedImpact;
  if (cost && cost.percent < 0) return { text: `−${Math.abs(cost.percent)}% cost`, gain: true };
  if (speed && speed.latencyMs < 0) return { text: `${signed(seconds(speed.latencyMs), speed.latencyMs)} run`, gain: true };
  if (reliability) return { text: `−${reliability.retriesAvoided} retr${reliability.retriesAvoided === 1 ? "y" : "ies"}`, gain: true };
  if (cost) return { text: `+${cost.percent}% cost`, gain: false };
  return { text: "", gain: false };
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

function Headline({ input, result, analyzedWith }: { input: EvaluationInput; result: EvaluationResult; analyzedWith?: string }) {
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
        {analyzedWith && result.fallbackEvaluators.length === 0 ? ` · reviewed by ${modelLabel(analyzedWith)}` : ""}
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
                <SeverityIcon severity={r.severity} size={12} />
                <span className="opt-category">{CATEGORY_LABELS[r.category]}</span>
                <TagList tags={r.tags} />
                <span className="mono">{targetLabel(r)}</span>
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
        <SeverityIcon severity={r.severity} />
        <span className="opt-row-main">
          <span className="opt-row-title">{withInlineCode(r.title)}</span>
          <TagList tags={r.tags} />
        </span>
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

function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Shown while analyzing: the run's steps with a scan line sweeping across them (each step lights up
 * as it passes), a bar that fills as evaluators finish, and each evaluator's live status.
 */
function AnalysisProgress({
  input,
  progress,
  modelId,
  elapsedMs,
}: {
  input?: EvaluationInput;
  progress: Record<string, EvaluatorProgress & { finishedMs?: number }>;
  modelId: string;
  elapsedMs: number;
}) {
  const entries = Object.values(progress);
  const total = entries.length || 4;
  const finished = entries.filter((e) => e.status !== "running").length;

  const runStart = input ? Date.parse(input.run.startedAt) : 0;
  const span = input?.run.totalUsage?.latencyMs ?? 1;
  const steps = (input?.run.steps ?? []).map((step) => {
    const start = step.startedAt ? (Date.parse(step.startedAt) - runStart) / span : 0;
    const end = step.completedAt ? (Date.parse(step.completedAt) - runStart) / span : 1;
    return { id: step.id, name: input!.agents.find((a) => a.id === step.agentId)?.name ?? step.agentId, start, end };
  });

  function detail(e: EvaluatorProgress & { finishedMs?: number }): string {
    const found = `${e.recommendations ?? 0} found`;
    const took = e.finishedMs && e.finishedMs >= 1000 ? ` · ${clock(e.finishedMs)}` : "";
    switch (e.status) {
      case "running":
        return e.modelBacked ? `Asking ${modelLabel(modelId)} · ${clock(elapsedMs)}` : "Checking…";
      case "done":
        return found + took;
      case "fallback":
        return `Claude unavailable, used built-in rules · ${found}`;
      case "skipped":
        return "Not analyzed";
    }
  }

  return (
    <section className="opt-progress" aria-label="Analysis progress">
      <div className="opt-progress-head">
        <div>
          <div className="opt-eyebrow">{input ? `${input.flow.name} · ${input.run.id}` : "Loading run…"}</div>
          <h2 className="opt-progress-title">Reviewing the run with {modelLabel(modelId)}</h2>
        </div>
        <div className="opt-progress-clock" aria-label={`Elapsed ${clock(elapsedMs)}`}>
          {clock(elapsedMs)}
        </div>
      </div>

      <div
        className="opt-progress-bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={finished}
        aria-valuetext={`${finished} of ${total} evaluators finished`}
      >
        <div className="fill" style={{ width: `${Math.max((finished / total) * 100, 3)}%` }} />
      </div>

      {steps.length ? (
        <div className="opt-scan" aria-hidden="true">
          {steps.map((s) => (
            <div key={s.id} className="opt-scan-row">
              <span className="opt-scan-name">{s.name}</span>
              <span className="opt-scan-track">
                <span
                  className="opt-scan-bar"
                  style={{ left: `${s.start * 100}%`, width: `${(s.end - s.start) * 100}%`, animationDelay: `${s.start * 2.8}s` }}
                />
              </span>
            </div>
          ))}
          <span className="opt-scan-line" />
        </div>
      ) : null}

      <ul className="opt-checklist" aria-live="polite">
        {entries.map((e) => (
          <li key={e.evaluatorId} className={`is-${e.status}`}>
            <span className="opt-status-icon" aria-hidden="true">
              {e.status === "done" ? "✓" : e.status === "fallback" ? "!" : e.status === "skipped" ? "×" : ""}
            </span>
            <span className="name">{CATEGORY_LABELS[e.category]}</span>
            <span className="detail">{detail(e)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Split button: the main part analyzes with the default model; the arrow opens a menu to pick another model and analyze with it. */
function AnalyzeButton({
  defaultModel,
  disabled,
  analyzing,
  onAnalyze,
}: {
  defaultModel: string;
  disabled: boolean;
  analyzing: boolean;
  onAnalyze: (modelId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus();
    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function moveFocus(e: React.KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") ?? [])];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(index + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
  }

  return (
    <div className="opt-split" ref={rootRef}>
      <button className="opt-primary opt-split-main" disabled={disabled} onClick={() => onAnalyze(defaultModel)} title={`Analyze with ${modelLabel(defaultModel)}`}>
        {analyzing ? "Analyzing…" : "Analyze run"}
      </button>
      <button
        ref={toggleRef}
        className="opt-primary opt-split-toggle"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Analyze with another model"
        onClick={() => setOpen((o) => !o)}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open ? (
        <div className="opt-menu" role="menu" aria-label="Analyze with" ref={menuRef} onKeyDown={moveFocus}>
          <div className="opt-menu-label" aria-hidden="true">
            Analyze with
          </div>
          {EVALUATOR_MODELS.map((m) => (
            <button
              key={m.id}
              role="menuitem"
              className="opt-menu-item"
              onClick={() => {
                setOpen(false);
                onAnalyze(m.id);
              }}
            >
              <span className="name">
                {m.label}
                {m.id === defaultModel ? <span className="badge">Default</span> : null}
              </span>
              <span className="note">{m.note}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SettingsDialog({
  open,
  defaultModel,
  onChangeDefaultModel,
  onClose,
}: {
  open: boolean;
  defaultModel: string;
  onChangeDefaultModel: (modelId: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="opt-dialog"
      aria-labelledby="opt-settings-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose(); // click on the backdrop
      }}
    >
      <form method="dialog">
        <h2 id="opt-settings-title">Settings</h2>
        <fieldset>
          <legend>Default model</legend>
          <p className="hint">Used when you click Analyze run. Pick another model for a single run from the arrow next to it.</p>
          {EVALUATOR_MODELS.map((m) => (
            <label key={m.id} className="opt-radio">
              <input type="radio" name="default-model" value={m.id} checked={m.id === defaultModel} onChange={() => onChangeDefaultModel(m.id)} />
              <span>
                <span className="name">{m.label}</span>
                <span className="note">{m.note}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="opt-dialog-actions">
          <button className="opt-primary" value="done">
            Done
          </button>
        </div>
      </form>
    </dialog>
  );
}

function GearIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
