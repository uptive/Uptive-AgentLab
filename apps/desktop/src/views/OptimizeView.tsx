import { useEffect, useMemo, useRef, useState } from "react";
import {
  RECOMMENDATION_TAGS,
  type EvaluationResult,
  type Recommendation,
  type RecommendationCategory,
  type RecommendationTag,
} from "@agentlab/contracts";
import {
  CATEGORIES,
  DEFAULT_EVALUATOR_MODEL,
  EVALUATOR_MODELS,
  analyzeRun,
  conflictsWith,
  createEvaluators,
  getModel,
  notTestableReason,
  planChanges,
  type EvaluationInput,
  type EvaluatorProgress,
} from "@agentlab/optimization";
import { SeverityIcon, TagIcon } from "../optimize/badges.js";
import { ChangeTray, TrialPanel, type TrialState } from "../optimize/TrialPanel.js";
import { applyPlan, resolveDestinations, runTrial } from "../optimize/trial.js";
import { type ModelAnalysis, modelLabel } from "../optimize/analysis.js";
import { CATEGORY_LABELS, percentChange, seconds, signed, targetName, usd, withInlineCode } from "../optimize/format.js";
import { Impact } from "../optimize/impact.js";
import { MODEL_BACKED, ModelLanes, laneRows, type LaneRow } from "../optimize/ModelLanes.js";
import { RecommendationCard, type CardPick, type CardState } from "../optimize/RecommendationCard.js";
import { RecommendationDrawer } from "../optimize/RecommendationDrawer.js";
import { createModelClient, type ModelCallRecord } from "../optimize/modelClient.js";
import { RawDataDrawer } from "../optimize/RawDataDrawer.js";
import { runSource, type RunSummary } from "../optimize/runSource.js";
import "./OptimizeView.css";

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

/** Quality and Model Selection ask Claude on `modelId` (through Electron main); the others are rule-based. */
function evaluatorsFor(modelId: string, onCall: (call: ModelCallRecord) => void) {
  return createEvaluators(createModelClient(modelId, onCall));
}

const COMPARE_MODELS_KEY = "agentlab.optimize.compareModels";

function loadCompareModels(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(COMPARE_MODELS_KEY) ?? "null") as unknown;
    const valid = Array.isArray(saved) ? saved.filter((id) => EVALUATOR_MODELS.some((m) => m.id === id)) : [];
    return valid.length >= 2 ? valid : EVALUATOR_MODELS.map((m) => m.id);
  } catch {
    return EVALUATOR_MODELS.map((m) => m.id);
  }
}

/** Cards are keyed per model, so the same finding from two models can be told apart. */
const cardKey = (modelId: string, recommendationId: string) => `${modelId}::${recommendationId}`;

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
  const [defaultModel, setDefaultModel] = useState(loadDefaultModel);
  const [analyzedWith, setAnalyzedWith] = useState<string>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Live progress while analyzing: the run being reviewed, each evaluator's status, and a clock.
  const [pendingInput, setPendingInput] = useState<EvaluationInput>();
  // Per model being analyzed, in the order picked: each evaluator's live status.
  const [progress, setProgress] = useState<{ modelId: string; evaluators: Record<string, EvaluatorProgress & { finishedMs?: number }> }[]>([]);
  /** Every model's analysis of the run from the last Analyze or Compare. `result` is the first one. */
  const [analyses, setAnalyses] = useState<ModelAnalysis[]>([]);
  const [rawFor, setRawFor] = useState<string>();
  const [compareOpen, setCompareOpen] = useState(false);
  /** Card whose drawer is open. */
  const [openCard, setOpenCard] = useState<string>();
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  // Testing and applying changes: cards picked for the test, in the order picked, and the test itself.
  const [picked, setPicked] = useState<string[]>([]);
  const [trial, setTrial] = useState<TrialState>();
  const [testedKeys, setTestedKeys] = useState<string[]>([]);
  /** Cards whose changes were saved during this analysis. */
  const [applied, setApplied] = useState<Set<string>>(new Set());
  const trialRef = useRef<HTMLDivElement>(null);

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

  /** Analyzes the selected run with each of `modelIds` at the same time. */
  async function handleAnalyze(modelIds: string[]) {
    setAnalyzing(true);
    setProgress(modelIds.map((modelId) => ({ modelId, evaluators: {} })));
    setAnalyses([]);
    setRawFor(undefined);
    setOpenCard(undefined);
    setPendingInput(undefined);
    const started = Date.now();
    setStartedAt(started);
    setNow(started);
    setError(undefined);
    setCategoryFilter(undefined);
    setTagFilter(undefined);
    setNodeFilter(undefined);
    setPicked([]);
    setTrial(undefined);
    setTestedKeys([]);
    setApplied(new Set());
    try {
      const loaded = await runSource.loadRun(selectedRunId);
      setPendingInput(loaded);
      const results = await Promise.all(
        modelIds.map(async (modelId): Promise<ModelAnalysis> => {
          const calls: ModelCallRecord[] = [];
          const onProgress = (update: EvaluatorProgress) =>
            setProgress((current) =>
              current.map((p) =>
                p.modelId === modelId
                  ? { ...p, evaluators: { ...p.evaluators, [update.evaluatorId]: { ...update, finishedMs: update.status === "running" ? undefined : Date.now() - started } } }
                  : p,
              ),
            );
          try {
            const evaluation = await analyzeRun(loaded, evaluatorsFor(modelId, (call) => calls.push(call)), { onProgress });
            return { modelId, evaluation, calls, durationMs: Date.now() - started };
          } catch (e) {
            return { modelId, calls, durationMs: Date.now() - started, error: e instanceof Error ? e.message : String(e) };
          }
        }),
      );
      const shown = results.find((a) => a.evaluation);
      if (!shown) throw new Error(results.map((a) => `${modelLabel(a.modelId)}: ${a.error}`).join("; "));
      setInput(loaded);
      setAnalyses(results);
      setResult(shown.evaluation);
      setAnalyzedWith(shown.modelId);
    } catch (e) {
      setResult(undefined);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAnalyzing(false);
    }
  }

  // ---- Cards ----------------------------------------------------------------------------------
  const lead = analyzedWith ?? "";
  const comparing = analyses.filter((a) => a.evaluation).length > 1;
  /** Every card on screen by key. When comparing, built-in rule findings appear once (from the first model). */
  const cards = useMemo(() => {
    const map = new Map<string, { recommendation: Recommendation; modelId: string }>();
    for (const a of analyses) {
      for (const r of a.evaluation?.recommendations ?? []) {
        if (a.modelId !== lead && !MODEL_BACKED.has(r.category)) continue;
        map.set(cardKey(a.modelId, r.id), { recommendation: r, modelId: a.modelId });
      }
    }
    return map;
  }, [analyses, lead]);

  const pickedRecs = useMemo(() => picked.flatMap((key) => cards.get(key)?.recommendation ?? []), [picked, cards]);
  const plan = useMemo(() => (input && pickedRecs.length ? planChanges(input, pickedRecs) : undefined), [input, pickedRecs]);
  const trialActive = Boolean(trial && !trial.results);

  /** Why a card's checkbox is off, or undefined when it can be picked. */
  function pickBlocker(key: string, r: Recommendation): string | undefined {
    if (!input) return undefined;
    const reason = notTestableReason(input, r);
    if (reason) return `Can't be tested automatically: ${reason}.`;
    if (trialActive) return "Finish or discard the current test first.";
    if (picked.includes(key)) return undefined;
    const others = picked.filter((k) => k !== key).flatMap((k) => cards.get(k) ?? []);
    const sameFinding = others.find((o) => o.recommendation.id === r.id);
    if (sameFinding) return `${modelLabel(sameFinding.modelId)}'s version of this change is already picked.`;
    const clash = conflictsWith(
      r,
      others.map((o) => o.recommendation),
    )[0];
    return clash ? `"${clash.title}" already changes the same field.` : undefined;
  }

  function pickFor(key: string, r: Recommendation): CardPick {
    return {
      picked: picked.includes(key),
      blocker: pickBlocker(key, r),
      onPick: () => setPicked((current) => (current.includes(key) ? current.filter((p) => p !== key) : [...current, key])),
    };
  }

  const stateOf = (key: string): CardState | undefined => (applied.has(key) ? "applied" : trialActive && testedKeys.includes(key) ? "in-test" : undefined);

  function renderCard(r: Recommendation, modelId: string, context?: string) {
    const key = cardKey(modelId, r.id);
    return (
      <RecommendationCard
        key={key}
        recommendation={r}
        step={targetName(input!, r)}
        pick={pickFor(key, r)}
        state={stateOf(key)}
        onOpen={() => setOpenCard(key)}
        context={context}
      />
    );
  }

  // ---- Testing and applying ---------------------------------------------------------------------
  async function startTrial() {
    if (!plan || !input) return;
    const recommendationIds = plan.edits.map((e) => e.recommendationId);
    setTrial({ plan, recommendationIds });
    setTestedKeys(picked);
    requestAnimationFrame(() => trialRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    try {
      const { done } = await runTrial(plan, input.run.id, recommendationIds, (run) => setTrial((t) => t && { ...t, run }));
      const run = await done;
      setTrial((t) => t && { ...t, run });
    } catch (e) {
      setTrial((t) => t && { ...t, error: `The test run didn't start: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  async function reviewApply() {
    if (!trial) return;
    try {
      const review = await resolveDestinations(trial.plan);
      setTrial((t) => t && { ...t, review });
    } catch (e) {
      setTrial((t) => t && { ...t, error: `Couldn't look up where to save: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  async function confirmApply() {
    if (!trial?.review) return;
    setTrial((t) => t && { ...t, applying: true });
    const results = await applyPlan(trial.plan, trial.review.destinations, trial.review.flow);
    setTrial((t) => t && { ...t, applying: false, results });
    const savedIds = new Set(results.filter((r) => r.ok).map((r) => r.edit.recommendationId));
    setApplied((current) => new Set([...current, ...testedKeys.filter((k) => savedIds.has(cards.get(k)?.recommendation.id ?? ""))]));
  }

  function closeTrial() {
    setPicked([]);
    setTrial(undefined);
    setTestedKeys([]);
  }

  // ---- Filters ------------------------------------------------------------------------------------
  // Category, tag and step filters combine: each list counts what the other filters leave.
  const matchesNode = (r: Recommendation) => !nodeFilter || (r.target.kind === "node" && r.target.nodeId === nodeFilter);
  const matchesCategory = (r: Recommendation) => !categoryFilter || r.category === categoryFilter;
  const matchesTag = (r: Recommendation) => !tagFilter || (r.tags ?? []).includes(tagFilter);
  const matchesAll = (r: Recommendation) => matchesNode(r) && matchesCategory(r) && matchesTag(r);

  const rows = useMemo(() => (comparing ? laneRows(analyses) : []), [analyses, comparing]);
  const shared = comparing ? (result?.recommendations ?? []).filter((r) => !MODEL_BACKED.has(r.category)) : [];
  /** One recommendation per distinct finding on screen: what the filters count. */
  const pool = comparing ? [...shared, ...rows.map((row) => row.byModel.find(Boolean)!)] : (result?.recommendations ?? []);
  const rowMatches = (row: LaneRow) => row.byModel.some((r) => r && matchesAll(r));
  const visibleRows = rows.filter(rowMatches);
  const visible = pool.filter(matchesAll);
  const categoryCount = (category: RecommendationCategory) => pool.filter((r) => r.category === category && matchesNode(r) && matchesTag(r)).length;
  const tagCount = (tag: RecommendationTag) => pool.filter((r) => (r.tags ?? []).includes(tag) && matchesNode(r) && matchesCategory(r)).length;
  const usedTags = RECOMMENDATION_TAGS.filter((tag) => pool.some((r) => r.tags?.includes(tag)));

  const open = openCard ? cards.get(openCard) : undefined;

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
          <AnalyzeButton
            defaultModel={defaultModel}
            disabled={!selectedRunId || analyzing}
            analyzing={analyzing}
            onAnalyze={(modelId) => handleAnalyze([modelId])}
            onCompare={() => setCompareOpen(true)}
          />
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

      <CompareDialog
        open={compareOpen}
        onClose={() => setCompareOpen(false)}
        onCompare={(modelIds) => {
          setCompareOpen(false);
          void handleAnalyze(modelIds);
        }}
      />

      {input ? (
        <>
          <RawDataDrawer analysis={analyses.find((a) => a.modelId === rawFor)} input={input} onClose={() => setRawFor(undefined)} />
          <RecommendationDrawer
            recommendation={open?.recommendation}
            foundBy={open && MODEL_BACKED.has(open.recommendation.category) ? open.modelId : undefined}
            input={input}
            pick={open ? pickFor(openCard!, open.recommendation) : undefined}
            state={openCard ? stateOf(openCard) : undefined}
            takes={
              comparing && open && MODEL_BACKED.has(open.recommendation.category)
                ? analyses.map((a) => ({ modelId: a.modelId, recommendation: a.evaluation?.recommendations.find((r) => r.id === open.recommendation.id) }))
                : undefined
            }
            onClose={() => setOpenCard(undefined)}
          />
        </>
      ) : null}

      {error ? <p className="opt-error">{error}</p> : null}
      {analyzing ? <AnalysisProgress input={pendingInput} progress={progress} elapsedMs={now - startedAt} /> : null}
      {!result && !analyzing && !error ? <p className="opt-empty">Pick a run and analyze it to see what to change.</p> : null}

      {input && result && !analyzing ? (
        <>
          <Headline
            input={input}
            result={result}
            analyzedWith={comparing ? undefined : analyzedWith}
            compare={comparing}
            onShowRaw={!comparing && analyzedWith ? () => setRawFor(analyzedWith) : undefined}
          />
          {!comparing
            ? [...result.skippedEvaluators.map((s) => ({ ...s, text: "was not analyzed" })), ...result.fallbackEvaluators.map((s) => ({ ...s, text: "used built-in rules because Claude was unavailable" }))].map((s) => (
                <p key={s.evaluatorId} className="opt-notice">
                  {CATEGORY_LABELS[s.category]} {s.text}: {s.reason}
                </p>
              ))
            : null}

          {trial ? (
            <div ref={trialRef}>
              <TrialPanel
                trial={trial}
                base={input}
                onApply={reviewApply}
                onConfirmApply={confirmApply}
                onCancelApply={() => setTrial((t) => t && { ...t, review: undefined })}
                onDiscard={closeTrial}
              />
            </div>
          ) : null}

          <section className="opt-section">
            <div className="opt-section-head">
              <h2>Timeline</h2>
              <div className="opt-legend" aria-hidden="true">
                <span className="measured">Measured</span>
                {comparing ? null : <span className="projected">With all fixes</span>}
              </div>
            </div>
            <Timeline
              input={input}
              result={result}
              projected={!comparing}
              findings={pool}
              selectedNodeId={nodeFilter}
              onSelectNode={(id) => setNodeFilter(id === nodeFilter ? undefined : id)}
            />
          </section>

          {!comparing ? <FixFirst result={result} input={input} onSelect={(id) => setOpenCard(cardKey(lead, id))} /> : null}

          <section className="opt-section">
            <div className="opt-section-head">
              <h2>{comparing ? "Findings side by side" : "Recommendations"}</h2>
              <div className="opt-filters" role="group" aria-label="Filter by category">
                <button aria-pressed={!categoryFilter} onClick={() => setCategoryFilter(undefined)}>
                  All<span className="count">{pool.filter((r) => matchesNode(r) && matchesTag(r)).length}</span>
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

            {comparing ? (
              <>
                <ModelLanes
                  analyses={analyses.filter((a) => a.evaluation)}
                  rows={visibleRows}
                  baseline={result.summary.baseline}
                  renderCard={(r, modelId) => renderCard(r, modelId)}
                  onShowRaw={setRawFor}
                />
                {shared.some(matchesAll) ? (
                  <div className="opt-group opt-shared">
                    <div className="opt-group-head">
                      <h3>Same for every model</h3>
                      <span className="totals">Built-in rules for token use and flow design</span>
                    </div>
                    <div className="opt-cards">{shared.filter(matchesAll).map((r) => renderCard(r, lead, CATEGORY_LABELS[r.category]))}</div>
                  </div>
                ) : null}
              </>
            ) : (
              <>
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
                      <div className="opt-cards">{group.map((r) => renderCard(r, lead))}</div>
                    </div>
                  );
                })}
              </>
            )}
          </section>

          {plan && !trial ? <ChangeTray plan={plan} busy={trialActive} onTest={startTrial} onClear={() => setPicked([])} /> : null}
        </>
      ) : null}
    </div>
  );
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

function Headline({
  input,
  result,
  analyzedWith,
  compare,
  onShowRaw,
}: {
  input: EvaluationInput;
  result: EvaluationResult;
  analyzedWith?: string;
  /** Several models: show the measured run only; each model's estimate heads its column. */
  compare?: boolean;
  onShowRaw?: () => void;
}) {
  const { baseline, projected } = result.summary;
  const usage = input.run.totalUsage;
  const figures = [
    {
      label: "Run time",
      before: seconds(baseline.latencyMs),
      after: seconds(projected.latencyMs),
      delta: percentChange(baseline.latencyMs, projected.latencyMs),
      changed: !compare && Math.abs(projected.latencyMs - baseline.latencyMs) >= 100,
    },
    {
      label: "Cost per run",
      before: usd(baseline.costUsd),
      after: usd(projected.costUsd),
      delta: percentChange(baseline.costUsd, projected.costUsd),
      changed: !compare && Math.abs(projected.costUsd - baseline.costUsd) >= 0.00005,
    },
  ];
  // Quality findings carry a risk level, not a time or cost estimate, so they don't move these figures.
  const recs = result.recommendations;
  const estimated = recs.filter((r) => r.estimatedImpact.cost || r.estimatedImpact.speed || r.change.type === "set-dependencies");
  const qualityOnly = recs.length - estimated.length;
  const risks = (["high", "medium", "low"] as const)
    .map((level) => [level, recs.filter((r) => !estimated.includes(r) && r.estimatedImpact.quality?.risk === level).length] as const)
    .filter(([, n]) => n > 0)
    .map(([level, n]) => `${n} ${level}`);
  const explanation = compare
    ? "Measured in this run. Each model's estimate is at the top of its column below."
    : recs.length === 0
      ? "No recommendations for this run."
      : estimated.length === 0
        ? `None of the ${recs.length} recommendations changes run time or cost: they improve output quality${risks.length ? ` (${risks.join(", ")} risk)` : ""}. Test them to see how the output changes.`
        : qualityOnly > 0
          ? `Estimated if you apply the ${estimated.length} recommendation${estimated.length === 1 ? "" : "s"} that affect time or cost. The other ${qualityOnly} improve output quality and don't change these figures.`
          : `Estimated if you apply all ${recs.length} recommendations.`;
  return (
    <section className="opt-hero">
      <div className="opt-eyebrow">
        {input.flow.name} · <span className="mono">{input.run.id}</span>
        {analyzedWith && result.fallbackEvaluators.length === 0 ? ` · reviewed by ${modelLabel(analyzedWith)}` : ""}
        {onShowRaw ? (
          <button className="opt-link opt-raw-button" onClick={onShowRaw}>
            Raw data
          </button>
        ) : null}
      </div>
      <div className="opt-figures">
        {figures.map((f) => (
          <div key={f.label}>
            <div className="opt-figure-label">{f.label}</div>
            {f.changed ? (
              <>
                <div className="opt-figure-value">
                  <span className="opt-figure-before">{f.before}</span>
                  <span className="opt-figure-arrow" aria-label="becomes">
                    →
                  </span>
                  <span className="opt-figure-after">{f.after}</span>
                </div>
                <div className="opt-figure-delta">{f.delta}</div>
              </>
            ) : (
              <>
                <div className="opt-figure-value">
                  <span className="opt-figure-after is-unchanged">{f.before}</span>
                </div>
                <div className="opt-figure-delta">{compare ? "Measured" : "No change"}</div>
              </>
            )}
          </div>
        ))}
      </div>
      <p className="opt-caption">
        {explanation} Measured over {input.run.steps.length} steps
        {usage ? ` and ${(usage.inputTokens + usage.outputTokens).toLocaleString("en-US")} tokens` : ""}.
        {input.run.authSource === "subscription" ? " The run used a Claude subscription, so costs are estimates at API list prices." : ""}
      </p>
    </section>
  );
}

/** One row per step: measured bar, and a mint outline where it would run with every fix applied. */
function Timeline({
  input,
  result,
  projected = true,
  findings,
  selectedNodeId,
  onSelectNode,
}: {
  input: EvaluationInput;
  result: EvaluationResult;
  /** Show where each step would run with every fix applied. */
  projected?: boolean;
  /** Findings counted per step. */
  findings: Recommendation[];
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
  const spanMs = Math.max(...timeline.flatMap((t) => (projected ? [t.measured.endMs, t.projected.endMs] : [t.measured.endMs])));
  const pct = (ms: number) => `${(ms / spanMs) * 100}%`;
  const ticks = Array.from({ length: Math.floor(spanMs / 10_000) + 1 }, (_, i) => i * 10_000);

  return (
    <div className="opt-timeline">
      {timeline.map((t) => {
        const node = input.flow.nodes.find((n) => n.id === t.nodeId);
        const agent = input.agents.find((a) => a.id === node?.agentId);
        const count = findings.filter((r) => r.target.kind === "node" && r.target.nodeId === t.nodeId).length;
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
              aria-label={`${agent?.name ?? t.nodeId}: measured ${seconds(t.measured.startMs)} to ${seconds(t.measured.endMs)}${projected ? `, with all fixes ${seconds(t.projected.startMs)} to ${seconds(t.projected.endMs)}` : ""}`}
            >
              <div className="opt-tl-bar measured" style={{ left: pct(t.measured.startMs), width: pct(t.measured.endMs - t.measured.startMs) }} />
              {projected ? <div className="opt-tl-bar projected" style={{ left: pct(shown.startMs), width: pct(shown.endMs - shown.startMs) }} /> : null}
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

function FixFirst({ result, input, onSelect }: { result: EvaluationResult; input: EvaluationInput; onSelect: (id: string) => void }) {
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
            <button onClick={() => onSelect(r.id)} aria-haspopup="dialog">
              <span className="opt-top-title">{withInlineCode(r.title)}</span>
              <span className="opt-top-meta">
                <SeverityIcon severity={r.severity} size={12} />
                <span className="opt-category">{CATEGORY_LABELS[r.category]}</span>
                <span>{targetName(input, r)}</span>
              </span>
              <Impact recommendation={r} />
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

const GLOW_ON = "background: var(--mint); box-shadow: 0 0 14px color-mix(in srgb, var(--mint) 70%, transparent);";
const GLOW_OFF = "background: var(--bar); box-shadow: none;";

/**
 * Keyframes that light a bar from the moment the scan line reaches its start until the line has
 * passed its end, then fade it. The line sweeps the track once per cycle (opt-sweep), so the bar's
 * start and end, as fractions of the track, are also its on and off times in the cycle.
 */
function glowKeyframes(name: string, start: number, end: number): string {
  // Round first: a bar ending at 99.998% must not produce an "on" and an "off" keyframe that are
  // both written as 100%, where the later "off" wins and dims the bar while the line is still on it.
  const pct = (fraction: number) => Math.round(Math.min(100, Math.max(0, fraction * 100)) * 100) / 100;
  const [on, off] = [pct(start), pct(end)];
  // A bar that ends at the edge stays lit until the sweep starts over; others fade just after the line passes.
  const fadesOut = off <= 99.5;
  const stops = [
    on > 0 ? `0%, ${on}% { ${GLOW_OFF} }` : "",
    `${on > 0 ? Math.min(on + 0.01, off) : 0}%, ${off}% { ${GLOW_ON} }`,
    fadesOut ? `${Math.min(100, off + 4)}%, 100% { ${GLOW_OFF} }` : "",
  ];
  return `@keyframes ${name} { ${stops.join(" ")} }`;
}

/**
 * Shown while analyzing: the run's steps with a scan line sweeping across them (each step stays lit while the line is over it),
 * a bar that fills as evaluators finish, and each evaluator's live status.
 */
type ProgressEntry = EvaluatorProgress & { finishedMs?: number };

function AnalysisProgress({
  input,
  progress,
  elapsedMs,
}: {
  input?: EvaluationInput;
  /** Evaluator progress per model, in the order the models were picked. */
  progress: { modelId: string; evaluators: Record<string, ProgressEntry> }[];
  elapsedMs: number;
}) {
  const comparing = progress.length > 1;
  // Built-in rules give the same result for every model; when comparing, list them once.
  const groups = progress.map(({ modelId, evaluators }, i) => ({
    modelId,
    entries: Object.values(evaluators).filter((e) => !comparing || e.modelBacked || i === 0),
  }));
  const all = groups.flatMap((g) => g.entries);
  const total = all.length || 4 * progress.length;
  const finished = all.filter((e) => e.status !== "running").length;

  const runStart = input ? Date.parse(input.run.startedAt) : 0;
  const span = input?.run.totalUsage?.latencyMs ?? 1;
  const steps = (input?.run.steps ?? []).map((step) => {
    const start = step.startedAt ? (Date.parse(step.startedAt) - runStart) / span : 0;
    const end = step.completedAt ? (Date.parse(step.completedAt) - runStart) / span : 1;
    return { id: step.id, name: input!.agents.find((a) => a.id === step.agentId)?.name ?? step.agentId, start, end };
  });

  function detail(e: ProgressEntry, modelId: string): string {
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

  const models = progress.map((p) => modelLabel(p.modelId));
  const modelList = models.length > 1 ? `${models.slice(0, -1).join(", ")} and ${models[models.length - 1]}` : models[0];

  return (
    <section className="opt-progress" aria-label="Analysis progress">
      <div className="opt-progress-head">
        <div>
          <div className="opt-eyebrow">{input ? `${input.flow.name} · ${input.run.id}` : "Loading run…"}</div>
          <h2 className="opt-progress-title">Reviewing the run with {modelList}</h2>
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
          <style>{steps.map((s, i) => glowKeyframes(`opt-glow-${i}`, s.start, s.end)).join("\n")}</style>
          {steps.map((s, i) => (
            <div key={s.id} className="opt-scan-row">
              <span className="opt-scan-name">{s.name}</span>
              <span className="opt-scan-track">
                <span
                  className="opt-scan-bar"
                  style={{ left: `${s.start * 100}%`, width: `${(s.end - s.start) * 100}%`, ["--glow" as string]: `opt-glow-${i}` }}
                />
              </span>
            </div>
          ))}
          <span className="opt-scan-line" />
        </div>
      ) : null}

      {groups.map((g, i) => (
        <div key={g.modelId} className="opt-progress-group">
          {comparing ? <h3 className="opt-subhead">{modelLabel(g.modelId)}</h3> : null}
          <ul className="opt-checklist" aria-live="polite">
            {g.entries.map((e) => (
              <li key={e.evaluatorId} className={`is-${e.status}`}>
                <span className="opt-status-icon" aria-hidden="true">
                  {e.status === "done" ? "✓" : e.status === "fallback" ? "!" : e.status === "skipped" ? "×" : ""}
                </span>
                <span className="name">
                  {CATEGORY_LABELS[e.category]}
                  {comparing && !e.modelBacked && i === 0 ? " (built-in rules, same for all models)" : ""}
                </span>
                <span className="detail">{detail(e, g.modelId)}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

/** Split button: the main part analyzes with the default model; the arrow opens a menu to pick another model and analyze with it. */
function AnalyzeButton({
  defaultModel,
  disabled,
  analyzing,
  onAnalyze,
  onCompare,
}: {
  onCompare: () => void;
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
          <div className="opt-menu-sep" role="separator" />
          <button
            role="menuitem"
            className="opt-menu-item"
            onClick={() => {
              setOpen(false);
              onCompare();
            }}
          >
            <span className="name">Compare models…</span>
            <span className="note">Analyze with several models at once and compare what they find</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Picks the models to analyze the run with side by side. */
function CompareDialog({ open, onClose, onCompare }: { open: boolean; onClose: () => void; onCompare: (modelIds: string[]) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState<string[]>(loadCompareModels);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  function toggle(id: string) {
    setSelected((current) => (current.includes(id) ? current.filter((m) => m !== id) : EVALUATOR_MODELS.map((m) => m.id).filter((m) => m === id || current.includes(m))));
  }

  return (
    <dialog
      ref={ref}
      className="opt-dialog"
      aria-labelledby="opt-compare-dialog-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose(); // click on the backdrop
      }}
    >
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          try {
            localStorage.setItem(COMPARE_MODELS_KEY, JSON.stringify(selected));
          } catch {
            // Storage unavailable: the choice lasts for this session only.
          }
          onCompare(selected);
        }}
      >
        <h2 id="opt-compare-dialog-title">Compare models</h2>
        <fieldset>
          <legend>Analyze the run with</legend>
          <p className="hint">They run at the same time. Each one uses your Claude plan, so comparing three costs about three analyses.</p>
          {EVALUATOR_MODELS.map((m) => (
            <label key={m.id} className="opt-radio">
              <input type="checkbox" checked={selected.includes(m.id)} onChange={() => toggle(m.id)} />
              <span>
                <span className="name">{m.label}</span>
                <span className="note">{m.note}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="opt-dialog-actions">
          <button type="button" className="opt-link" onClick={onClose}>
            Cancel
          </button>
          <button className="opt-primary" disabled={selected.length < 2}>
            {selected.length < 2 ? "Pick at least two" : `Compare ${selected.length} models`}
          </button>
        </div>
      </form>
    </dialog>
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
