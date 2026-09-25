import type { ReactNode } from "react";
import type { Recommendation, RecommendationSeverity } from "@agentlab/contracts";
import { EVALUATOR_LABELS, analysisUsage, modelLabel, type ModelAnalysis } from "./analysis.js";
import { CATEGORY_LABELS, percentChange, seconds, usd } from "./format.js";

/** Categories whose findings come from the model; the others are rule-based and the same for every model. */
export const MODEL_BACKED = new Set(["quality", "model-selection"]);

const SEVERITY_RANK: Record<RecommendationSeverity, number> = { high: 0, medium: 1, low: 2 };

/** One finding across the compared models: each model's version of it, or undefined where a model didn't report it. */
export interface LaneRow {
  id: string;
  byModel: (Recommendation | undefined)[];
}

/** Model-backed findings of every analysis, one row per finding, most agreed-on first. */
export function laneRows(analyses: ModelAnalysis[]): LaneRow[] {
  const rows = new Map<string, LaneRow>();
  analyses.forEach((a, column) => {
    for (const r of a.evaluation?.recommendations ?? []) {
      if (!MODEL_BACKED.has(r.category)) continue;
      const row = rows.get(r.id) ?? { id: r.id, byModel: analyses.map(() => undefined) };
      row.byModel[column] = r;
      rows.set(r.id, row);
    }
  });
  const found = (row: LaneRow) => row.byModel.filter(Boolean) as Recommendation[];
  const worst = (row: LaneRow) => Math.min(...found(row).map((r) => SEVERITY_RANK[r.severity]));
  return [...rows.values()].sort((a, b) => found(b).length - found(a).length || worst(a) - worst(b));
}

function agreement(row: LaneRow, analyses: ModelAnalysis[]): string {
  const names = row.byModel.flatMap((r, i) => (r ? [modelLabel(analyses[i].modelId)] : []));
  if (names.length === analyses.length) return `All ${analyses.length} models`;
  if (names.length === 1) return `Only ${names[0]}`;
  return `${names.length} of ${analyses.length} · ${names.join(", ")}`;
}

/** Estimated run time and cost after applying a model's findings, next to the measured run. */
function Estimate({ analysis, baseline }: { analysis: ModelAnalysis; baseline: { costUsd: number; latencyMs: number } }) {
  const projected = analysis.evaluation?.summary.projected;
  if (!projected) return null;
  const parts = [
    { now: baseline.latencyMs, after: projected.latencyMs, text: seconds(projected.latencyMs), min: 100, delta: percentChange(baseline.latencyMs, projected.latencyMs) },
    { now: baseline.costUsd, after: projected.costUsd, text: usd(projected.costUsd), min: 0.00005, delta: percentChange(baseline.costUsd, projected.costUsd) },
  ];
  return (
    <dl className="opt-lane-estimate">
      <dt>If you apply all</dt>
      {parts.map((p, i) => {
        const moved = Math.abs(p.after - p.now) >= p.min;
        return (
          <dd key={i} className={moved ? (p.after < p.now ? "gain" : "tradeoff") : "same"}>
            {p.text}
            <span className="opt-lane-delta">{moved ? p.delta : "no change"}</span>
          </dd>
        );
      })}
    </dl>
  );
}

/**
 * The compared models side by side. Each column is a model; each row is one finding, with a rail
 * through the cards of the models that reported it, so agreement and gaps show at a glance.
 */
export function ModelLanes({
  analyses,
  rows,
  baseline,
  renderCard,
  onShowRaw,
}: {
  analyses: ModelAnalysis[];
  /** Rows to show (already filtered). */
  rows: LaneRow[];
  baseline: { costUsd: number; latencyMs: number };
  renderCard: (recommendation: Recommendation, modelId: string) => ReactNode;
  onShowRaw: (modelId: string) => void;
}) {
  const columns = { gridTemplateColumns: `repeat(${analyses.length}, minmax(0, 1fr))` };
  return (
    <div className="opt-lanes" style={{ ["--lanes" as string]: analyses.length }}>
      <div className="opt-lane-heads" style={columns}>
        {analyses.map((a) => {
          const usage = analysisUsage(a);
          const found = a.evaluation?.recommendations.filter((r) => MODEL_BACKED.has(r.category)) ?? [];
          const high = found.filter((r) => r.severity === "high").length;
          const fellBack = a.evaluation?.fallbackEvaluators ?? [];
          return (
            <section key={a.modelId} className="opt-lane-head" aria-label={modelLabel(a.modelId)}>
              <h3>{modelLabel(a.modelId)}</h3>
              <p className="opt-lane-found">
                {found.length} finding{found.length === 1 ? "" : "s"}
                {high ? <span> · {high} high</span> : null}
              </p>
              <Estimate analysis={a} baseline={baseline} />
              <p className="opt-lane-run">
                <abbr title="How long this model's analysis took, and what its calls would cost at API list prices. On a Claude subscription this is how much of your plan it used.">
                  Analysis
                </abbr>{" "}
                {seconds(a.durationMs)}
                {usage.hasCost ? ` · ${usd(usage.costUsd)}` : ""}
                {" · "}
                <button className="opt-link" onClick={() => onShowRaw(a.modelId)}>
                  Raw data
                </button>
              </p>
              {fellBack.length ? (
                <p className="opt-lane-warn" title={fellBack.map((f) => f.reason).join("\n")}>
                  Used built-in rules for {fellBack.map((f) => EVALUATOR_LABELS[f.evaluatorId] ?? f.evaluatorId).join(" and ")}: Claude was unavailable.
                </p>
              ) : null}
              {a.error ? <p className="opt-lane-warn">{a.error}</p> : null}
            </section>
          );
        })}
      </div>

      {rows.length === 0 ? <p className="opt-empty">No findings from the models match this filter.</p> : null}

      <ol className="opt-lane-rows">
        {rows.map((row) => {
          const cols = row.byModel.flatMap((r, i) => (r ? [i] : []));
          const [first, last] = [cols[0], cols[cols.length - 1]];
          const all = cols.length === analyses.length;
          const sample = row.byModel[first]!;
          return (
            <li key={row.id} className={`opt-lane-row${all ? " is-unanimous" : ""}`}>
              <p className="opt-lane-caption">
                <span className="opt-lane-agree">{agreement(row, analyses)}</span>
                <span> · {CATEGORY_LABELS[sample.category]}</span>
              </p>
              <div className="opt-lane-grid" style={columns}>
                {cols.length > 1 ? <span className="opt-rail" aria-hidden="true" style={{ gridColumn: `${first + 1} / ${last + 2}` }} /> : null}
                {row.byModel.map((r, i) => (
                  <div key={analyses[i].modelId} className="opt-lane-slot" style={{ gridColumn: i + 1 }}>
                    <span className="opt-lane-slot-label">{modelLabel(analyses[i].modelId)}</span>
                    {r ? renderCard(r, analyses[i].modelId) : <span className="opt-lane-empty">Not reported</span>}
                  </div>
                ))}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
