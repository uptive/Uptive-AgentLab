import { useEffect, useMemo, useState } from "react";
import type { ChangeType, EvaluationResult, Recommendation, RecommendationCategory, RecommendationChange } from "@agentlab/contracts";
import { CATEGORIES, analyzeRun, getModel, type EvaluationInput } from "@agentlab/optimization";
import { runSource, type RunSummary } from "../optimize/runSource.js";
import { colors } from "../theme.js";

const CATEGORY_INFO: Record<RecommendationCategory, { label: string; color: string }> = {
  quality: { label: "Quality", color: "#7FB2FF" },
  "model-selection": { label: "Model Selection", color: colors.accent },
  "token-context": { label: "Token & Context", color: "#F5C26B" },
  "flow-design": { label: "Flow Design", color: "#C79BFF" },
};

const SEVERITY_COLORS: Record<Recommendation["severity"], string> = {
  high: "#FF7A7A",
  medium: "#F5C26B",
  low: "#A0A0A0",
};

const CHANGE_LABELS: Record<ChangeType, string> = {
  "set-model": "model change",
  "remove-input": "input trimming",
  "replace-input": "input trimming",
  "add-output-schema": "output schema",
  "edit-instructions": "instructions",
  "extend-run-input": "run input",
  "set-dependencies": "dependency change",
  "add-node": "new step",
  "merge-nodes": "merge steps",
  "edit-role": "role change",
};

const cardStyle = { background: colors.bgGrey, borderRadius: 8, padding: 16 } as const;
const mutedText = { color: "#B8B8B8", fontSize: 13 } as const;
const sectionTitle = { fontSize: 13, textTransform: "uppercase", letterSpacing: 0.6, color: "#B8B8B8", margin: "28px 0 10px" } as const;

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
    setResult(undefined);
    setCategoryFilter(undefined);
    setNodeFilter(undefined);
    try {
      const loaded = await runSource.loadRun(selectedRunId);
      if (!loaded) throw new Error(`Run ${selectedRunId} not found`);
      const evaluation = await analyzeRun(loaded);
      setInput(loaded);
      setResult(evaluation);
      setExpanded(new Set(evaluation.recommendations.filter((r) => r.severity === "high").map((r) => r.id)));
    } catch (e) {
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
    <div style={{ maxWidth: 1000 }}>
      <h1>Optimize</h1>
      <p>Evaluator agents review a completed run, its agents and its flow, and suggest concrete improvements.</p>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 24 }}>
        <select
          value={selectedRunId}
          onChange={(e) => setSelectedRunId(e.target.value)}
          style={{ padding: "8px 10px", borderRadius: 6, border: `1px solid ${colors.bgCard}`, background: colors.bgGrey, color: colors.secondary, minWidth: 320 }}
        >
          {runs.length === 0 ? <option value="">No completed runs</option> : null}
          {runs.map((run) => (
            <option key={run.runId} value={run.runId}>
              {run.label}
            </option>
          ))}
        </select>
        <button
          onClick={handleAnalyze}
          disabled={!selectedRunId || analyzing}
          style={{
            padding: "8px 16px",
            border: "none",
            borderRadius: 6,
            background: colors.accent,
            color: colors.bgBlack,
            fontWeight: 600,
            cursor: selectedRunId && !analyzing ? "pointer" : "default",
            opacity: selectedRunId && !analyzing ? 1 : 0.6,
          }}
        >
          {analyzing ? "Analyzing…" : "Analyze Run"}
        </button>
      </div>

      {error ? <p style={{ color: SEVERITY_COLORS.high }}>{error}</p> : null}
      {!result && !analyzing && !error ? <p style={mutedText}>Pick a run and click “Analyze Run”.</p> : null}

      {input && result ? (
        <>
          <RunSummaryBar input={input} result={result} />
          {result.skippedEvaluators.map((s) => (
            <p key={s.evaluatorId} style={{ ...cardStyle, padding: "10px 14px", color: SEVERITY_COLORS.medium, fontSize: 13 }}>
              {CATEGORY_INFO[s.category].label} evaluator skipped: {s.reason}
            </p>
          ))}
          <CategoryTiles
            result={result}
            activeCategory={categoryFilter}
            onSelect={(category) => setCategoryFilter(category === categoryFilter ? undefined : category)}
          />
          <TopFixes result={result} onSelect={focusRecommendation} />

          <h2 style={sectionTitle}>Flow</h2>
          <FlowMap input={input} result={result} selectedNodeId={nodeFilter} onSelectNode={(id) => setNodeFilter(id === nodeFilter ? undefined : id)} />

          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", margin: "28px 0 4px" }}>
            <h2 style={{ ...sectionTitle, margin: 0 }}>All recommendations</h2>
            {categoryFilter ? (
              <FilterChip label={`${CATEGORY_INFO[categoryFilter].label} ✕`} color={CATEGORY_INFO[categoryFilter].color} onClick={() => setCategoryFilter(undefined)} />
            ) : null}
            {nodeFilter ? <FilterChip label={`Node ${nodeFilter} ✕`} onClick={() => setNodeFilter(undefined)} /> : null}
          </div>
          {visible.length === 0 ? <p style={mutedText}>No recommendations match this filter.</p> : null}
          {CATEGORIES.map((category) => {
            const group = visible.filter((r) => r.category === category);
            if (group.length === 0) return null;
            return (
              <section key={category} style={{ marginTop: 16 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, margin: "0 0 8px" }}>
                  <span style={{ color: CATEGORY_INFO[category].color, fontWeight: 700 }}>{CATEGORY_INFO[category].label}</span>
                  <span style={mutedText}>{group.length}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {group.map((r) => (
                    <RecommendationRow
                      key={r.id}
                      recommendation={r}
                      input={input}
                      expanded={expanded.has(r.id)}
                      onToggle={() => toggleExpanded(r.id)}
                      onSelectNode={setNodeFilter}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </>
      ) : null}
    </div>
  );
}

function usd(value: number, signed = false): string {
  const text = `$${Math.abs(value).toFixed(4)}`;
  return signed ? `${value < 0 ? "−" : "+"}${text}` : text;
}

function seconds(ms: number, signed = false): string {
  const text = `${(Math.abs(ms) / 1000).toFixed(1)}s`;
  return signed ? `${ms < 0 ? "−" : "+"}${text}` : text;
}

/** The one number that best describes a recommendation: cost, then speed, then retries, then quality risk. */
function headlineImpact(r: Recommendation): string {
  const { cost, speed, reliability, quality } = r.estimatedImpact;
  if (cost) return `${cost.percent < 0 ? "−" : "+"}${Math.abs(cost.percent)}% cost`;
  if (speed) return `${seconds(speed.latencyMs, true)} run`;
  if (reliability) return `−${reliability.retriesAvoided} retr${reliability.retriesAvoided === 1 ? "y" : "ies"}`;
  if (quality) return `${quality.risk} risk`;
  return "";
}

function targetLabel(r: Recommendation): string {
  return r.target.kind === "node" ? r.target.nodeId : r.target.kind === "agent" ? r.target.agentId : "flow";
}

function RunSummaryBar({ input, result }: { input: EvaluationInput; result: EvaluationResult }) {
  const usage = input.run.totalUsage;
  const { baseline, projected } = result.summary;
  const stats: [string, React.ReactNode][] = [
    ["Flow", input.flow.name],
    ["Steps", input.run.steps.length],
    ["Tokens", usage ? (usage.inputTokens + usage.outputTokens).toLocaleString("en-US") : "–"],
    ["Cost / run", <BeforeAfter before={usd(baseline.costUsd)} after={usd(projected.costUsd)} />],
    ["Latency", <BeforeAfter before={seconds(baseline.latencyMs)} after={seconds(projected.latencyMs)} />],
  ];
  return (
    <div style={{ display: "flex", gap: 28, flexWrap: "wrap", marginBottom: 20 }}>
      {stats.map(([label, value]) => (
        <div key={label}>
          <div style={mutedText}>{label}</div>
          <div style={{ fontWeight: 600 }}>{value}</div>
        </div>
      ))}
    </div>
  );
}

function BeforeAfter({ before, after }: { before: string; after: string }) {
  return (
    <span title="Measured → estimated with all recommendations applied">
      {before} <span style={mutedText}>→</span> <span style={{ color: colors.accent }}>{after}</span>
    </span>
  );
}

function CategoryTiles({
  result,
  activeCategory,
  onSelect,
}: {
  result: EvaluationResult;
  activeCategory?: RecommendationCategory;
  onSelect: (category: RecommendationCategory) => void;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
      {CATEGORIES.map((category) => {
        const summary = result.summary.byCategory[category];
        const skipped = result.skippedEvaluators.find((s) => s.category === category);
        const { label, color } = CATEGORY_INFO[category];
        const gains = [
          summary.usdPerRun && summary.usdPerRun < -0.00005 ? `${usd(summary.usdPerRun, true)}/run` : undefined,
          summary.latencyMs && summary.latencyMs <= -100 ? `${seconds(summary.latencyMs, true)}/run` : undefined,
        ].filter((g): g is string => Boolean(g));
        const issues = `${summary.count} issue${summary.count === 1 ? "" : "s"}`;
        const value = skipped ? "Skipped" : summary.count === 0 ? "–" : (gains[0] ?? issues);
        const detail = skipped
          ? "Could not run"
          : summary.count === 0
            ? "No issues found"
            : [...gains.slice(1), gains.length ? issues : undefined, summary.highestSeverity ? `highest: ${summary.highestSeverity}` : undefined]
                .filter(Boolean)
                .join(" · ");
        const active = activeCategory === category;
        const disabled = summary.count === 0;
        return (
          <button
            key={category}
            onClick={() => onSelect(category)}
            disabled={disabled}
            title={skipped?.reason ?? `Show ${label} recommendations`}
            style={{
              ...cardStyle,
              textAlign: "left",
              borderStyle: "solid",
              borderWidth: "3px 1px 1px",
              borderColor: active ? color : `${color} transparent transparent`,
              color: colors.secondary,
              cursor: disabled ? "default" : "pointer",
              opacity: disabled ? 0.55 : 1,
            }}
          >
            <div style={{ color, fontWeight: 600, fontSize: 13 }}>{label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, margin: "6px 0 2px" }}>{value}</div>
            <div style={mutedText}>{detail}</div>
          </button>
        );
      })}
    </div>
  );
}

function TopFixes({ result, onSelect }: { result: EvaluationResult; onSelect: (id: string) => void }) {
  const top = result.summary.topRecommendationIds
    .map((id) => result.recommendations.find((r) => r.id === id))
    .filter((r): r is Recommendation => Boolean(r));
  if (top.length === 0) return null;
  return (
    <>
      <h2 style={sectionTitle}>Top fixes</h2>
      <ol style={{ ...cardStyle, margin: 0, padding: "6px 0", listStyle: "none" }}>
        {top.map((r, i) => (
          <li key={r.id}>
            <button
              onClick={() => onSelect(r.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                width: "100%",
                padding: "8px 16px",
                background: "transparent",
                border: "none",
                color: colors.secondary,
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              <span style={{ ...mutedText, width: 16 }}>{i + 1}.</span>
              <span style={{ flex: 1, fontWeight: 600 }}>{withInlineCode(r.title)}</span>
              <CategoryChip category={r.category} />
              <span style={{ minWidth: 110, textAlign: "right", color: CATEGORY_INFO[r.category].color, fontWeight: 600 }}>{headlineImpact(r)}</span>
            </button>
          </li>
        ))}
      </ol>
    </>
  );
}

/** Flow nodes laid out by dependency depth, so parallel branches sit in the same column. */
function FlowMap({
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
  const columns = useMemo(() => {
    const depth = new Map<string, number>();
    const depthOf = (id: string): number => {
      if (!depth.has(id)) {
        const node = input.flow.nodes.find((n) => n.id === id);
        depth.set(id, node && node.dependsOn.length ? Math.max(...node.dependsOn.map(depthOf)) + 1 : 0);
      }
      return depth.get(id)!;
    };
    const grouped: (typeof input.flow.nodes)[] = [];
    for (const node of input.flow.nodes) (grouped[depthOf(node.id)] ??= []).push(node);
    return grouped;
  }, [input]);

  return (
    <div style={{ ...cardStyle, display: "flex", alignItems: "center", gap: 12, overflowX: "auto" }}>
      {columns.map((nodes, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {i > 0 ? <span style={mutedText}>→</span> : null}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {nodes.map((node) => {
              const agent = input.agents.find((a) => a.id === node.agentId);
              const step = input.run.steps.find((s) => s.nodeId === node.id);
              const recs = result.recommendations.filter((r) => r.target.kind === "node" && r.target.nodeId === node.id);
              const selected = selectedNodeId === node.id;
              return (
                <button
                  key={node.id}
                  onClick={() => onSelectNode(node.id)}
                  title={`Show recommendations for ${node.id}`}
                  style={{
                    textAlign: "left",
                    minWidth: 180,
                    padding: "8px 10px",
                    borderRadius: 6,
                    border: `1px solid ${selected ? colors.accent : colors.bgCard}`,
                    background: selected ? "#2A3A31" : colors.bgBlack,
                    color: colors.secondary,
                    cursor: "pointer",
                  }}
                >
                  <strong>{agent?.name ?? node.agentId}</strong>
                  <div style={{ ...mutedText, fontSize: 12 }}>
                    {getModel(agent?.model ?? "")?.label ?? agent?.model}
                    {step?.usage ? ` · $${step.usage.estimatedCostUsd.toFixed(4)} · ${seconds(step.usage.latencyMs)}` : ""}
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 4, minHeight: 16, flexWrap: "wrap" }}>
                    {CATEGORIES.map((category) => {
                      const count = recs.filter((r) => r.category === category).length;
                      return count ? (
                        <span key={category} style={{ fontSize: 12, color: CATEGORY_INFO[category].color }}>
                          ● {CATEGORY_INFO[category].label} {count}
                        </span>
                      ) : null;
                    })}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function RecommendationRow({
  recommendation: r,
  input,
  expanded,
  onToggle,
  onSelectNode,
}: {
  recommendation: Recommendation;
  input: EvaluationInput;
  expanded: boolean;
  onToggle: () => void;
  onSelectNode: (nodeId: string) => void;
}) {
  const target = r.target;
  const agent = target.kind !== "flow" ? input.agents.find((a) => a.id === target.agentId) : undefined;
  const { color } = CATEGORY_INFO[r.category];
  return (
    <article id={`rec-${r.id}`} style={{ background: colors.bgGrey, borderRadius: 8, borderLeft: `3px solid ${color}` }}>
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onToggle())}
        aria-expanded={expanded}
        style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", cursor: "pointer", flexWrap: "wrap" }}
      >
        <span style={{ ...mutedText, width: 10 }}>{expanded ? "▾" : "▸"}</span>
        <span title={`${r.severity} severity`} style={{ width: 8, height: 8, borderRadius: 4, background: SEVERITY_COLORS[r.severity] }} />
        <span style={{ flex: 1, minWidth: 200, fontWeight: 600 }}>{withInlineCode(r.title)}</span>
        {target.kind === "node" ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSelectNode(target.nodeId);
            }}
            title={`Filter to ${agent?.name ?? target.nodeId}`}
            style={{ fontSize: 12, padding: "2px 8px", borderRadius: 4, background: colors.bgBlack, color: colors.secondary, border: `1px solid ${colors.bgCard}`, cursor: "pointer" }}
          >
            <code>{target.nodeId}</code>
          </button>
        ) : (
          <span style={mutedText}>{targetLabel(r)}</span>
        )}
        <span style={{ minWidth: 100, textAlign: "right", color, fontWeight: 600 }}>{headlineImpact(r)}</span>
      </div>

      {expanded ? (
        <div style={{ padding: "0 14px 14px 42px" }}>
          <Field label="Problem">{withInlineCode(r.problem)}</Field>
          <Field label="Change">
            <ChangeDiff change={r.change} />
          </Field>
          <Field label="Why">{withInlineCode(r.suggestion)}</Field>
          <Field label="Estimated impact">
            <span style={{ color: colors.accent }}>{r.estimatedImpact.summary}</span>
          </Field>
          {r.evidence?.length ? (
            <details>
              <summary style={{ ...mutedText, cursor: "pointer" }}>Evidence from the run</summary>
              <ul style={{ ...mutedText, margin: "6px 0 0", paddingLeft: 18 }}>
                {r.evidence.map((line) => (
                  <li key={line}>{withInlineCode(line)}</li>
                ))}
              </ul>
            </details>
          ) : null}
          <div style={{ ...mutedText, fontSize: 12, marginTop: 10 }}>
            {CHANGE_LABELS[r.change.type]} · {agent?.name ?? targetLabel(r)} · {CATEGORY_INFO[r.category].label} evaluator
          </div>
        </div>
      ) : null}
    </article>
  );
}

function CategoryChip({ category }: { category: RecommendationCategory }) {
  const { label, color } = CATEGORY_INFO[category];
  return (
    <span style={{ fontSize: 11, padding: "1px 7px", borderRadius: 999, border: `1px solid ${color}`, color, whiteSpace: "nowrap" }}>{label}</span>
  );
}

function FilterChip({ label, color, onClick }: { label: string; color?: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "3px 10px",
        borderRadius: 999,
        border: `1px solid ${color ?? colors.secondary}`,
        background: colors.bgCard,
        color: color ?? colors.secondary,
        fontSize: 12,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "(none)";
  if (Array.isArray(value) && value.every((v) => typeof v === "string")) return `[${value.join(", ")}]`;
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function isInline(value: unknown): boolean {
  return formatValue(value).length <= 60 && !formatValue(value).includes("\n");
}

/** Before → after for a structured change: inline for short values, side by side for long ones. */
function ChangeDiff({ change }: { change: RecommendationChange }) {
  const removed = { color: "#FF9A9A", background: "#3A2626", padding: "1px 6px", borderRadius: 4 };
  const added = { color: colors.accent, background: "#243A2E", padding: "1px 6px", borderRadius: 4 };
  const path = <code style={{ ...mutedText, marginRight: 8 }}>{change.path}</code>;

  if (isInline(change.before) && isInline(change.after)) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {path}
        <code style={{ ...removed, textDecoration: change.after === null ? "line-through" : "none" }}>{formatValue(change.before)}</code>
        <span style={mutedText}>→</span>
        <code style={added}>{change.after === null ? "(removed)" : formatValue(change.after)}</code>
      </div>
    );
  }

  const block = { margin: 0, padding: 10, borderRadius: 6, fontSize: 12, whiteSpace: "pre-wrap", overflow: "auto", maxHeight: 220 } as const;
  return (
    <div>
      {path}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 8, marginTop: 6 }}>
        <div>
          <div style={{ ...mutedText, fontSize: 11 }}>Before</div>
          <pre style={{ ...block, color: "#FF9A9A", background: "#2E2323" }}>{formatValue(change.before)}</pre>
        </div>
        <div>
          <div style={{ ...mutedText, fontSize: 11 }}>After</div>
          <pre style={{ ...block, color: colors.accent, background: "#223027" }}>{formatValue(change.after)}</pre>
        </div>
      </div>
    </div>
  );
}

/** Renders `backtick` spans from evaluator text as <code>. */
function withInlineCode(text: string) {
  return text.split(/`([^`]+)`/).map((part, i) => (i % 2 ? <code key={i}>{part}</code> : part));
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ ...mutedText, fontSize: 12 }}>{label}</div>
      <div style={{ lineHeight: 1.45 }}>{children}</div>
    </div>
  );
}
