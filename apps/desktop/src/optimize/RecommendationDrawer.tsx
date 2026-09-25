import { useEffect, useRef } from "react";
import type { Recommendation } from "@agentlab/contracts";
import { getModel, notTestableReason, type EvaluationInput } from "@agentlab/optimization";
import { modelLabel } from "./analysis.js";
import { SeverityIcon, TagList } from "./badges.js";
import { CATEGORY_LABELS, CHANGE_LABELS, ChangeDiff, targetName, withInlineCode } from "./format.js";
import { ImpactSummary } from "./impact.js";
import { STATE_LABELS, type CardPick, type CardState } from "./RecommendationCard.js";

/** How one model saw the same finding, when several models analyzed the run. */
export interface OtherTake {
  modelId: string;
  recommendation?: Recommendation;
}

/** Everything about one suggestion, opened from its card. */
export function RecommendationDrawer({
  recommendation: r,
  foundBy,
  input,
  pick,
  state,
  takes,
  onClose,
}: {
  recommendation?: Recommendation;
  /** Model whose analysis this is; undefined for built-in rules. */
  foundBy?: string;
  input: EvaluationInput;
  pick?: CardPick;
  state?: CardState;
  takes?: OtherTake[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (r && !dialog.open) dialog.showModal();
    if (!r && dialog.open) dialog.close();
    dialog.querySelector(".opt-drawer-inner")?.scrollTo({ top: 0 });
  }, [r]);

  const notTestable = r ? notTestableReason(input, r) : undefined;

  return (
    <dialog
      ref={ref}
      className="opt-drawer"
      aria-labelledby="opt-rec-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose(); // click on the backdrop
      }}
    >
      {r ? (
        <div className="opt-drawer-inner">
          <header className="opt-drawer-head opt-rec-head">
            <div className="opt-rec-heading">
              <p className="opt-rec-eyebrow">
                <SeverityIcon severity={r.severity} size={12} />
                <span>
                  {r.severity[0].toUpperCase() + r.severity.slice(1)} · {CATEGORY_LABELS[r.category]} · {targetName(input, r)}
                </span>
                {state ? <span className={`opt-state ${state === "applied" ? "applied" : "running"}`}>{STATE_LABELS[state]}</span> : null}
              </p>
              <h2 id="opt-rec-title">{withInlineCode(r.title)}</h2>
              <TagList tags={r.tags} />
            </div>
            <button className="opt-icon-button" aria-label="Close" onClick={onClose}>
              ×
            </button>
          </header>

          <div className="opt-rec-test">
            {notTestable ? (
              <p className="hint">Can't be tested automatically: {notTestable}. Make this change by hand.</p>
            ) : pick ? (
              <label className={`opt-rec-toggle${pick.picked ? " is-on" : ""}`}>
                <input type="checkbox" checked={pick.picked} disabled={Boolean(pick.blocker) && !pick.picked} onChange={pick.onPick} />
                <span>
                  <strong>{pick.picked ? "Included in the next test run" : "Include in a test run"}</strong>
                  <span className="hint">{pick.blocker && !pick.picked ? pick.blocker : "Runs the flow with this change on copies. Nothing is saved until you apply."}</span>
                </span>
              </label>
            ) : null}
          </div>

          <section className="opt-rec-section">
            <h3>What's wrong</h3>
            <p>{withInlineCode(r.problem)}</p>
          </section>
          <section className="opt-rec-section">
            <h3>Change</h3>
            <p className="hint">
              {CHANGE_LABELS[r.change.type]} for {targetName(input, r)}
            </p>
            <ChangeDiff change={r.change} />
          </section>
          <section className="opt-rec-section">
            <h3>Why this helps</h3>
            <p>{withInlineCode(r.suggestion)}</p>
          </section>
          <section className="opt-rec-section">
            <h3>Expected effect</h3>
            <p>
              <ImpactSummary summary={r.estimatedImpact.summary} />
            </p>
          </section>
          {r.evidence?.length ? (
            <section className="opt-rec-section">
              <h3>Evidence from the run</h3>
              <ul>
                {r.evidence.map((line) => (
                  <li key={line}>{withInlineCode(line)}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {takes && takes.length > 1 ? (
            <section className="opt-rec-section">
              <h3>What each model said</h3>
              <ul className="opt-takes">
                {takes.map(({ modelId, recommendation: t }) => (
                  <li key={modelId} className={t ? "" : "is-missing"}>
                    <span className="opt-takes-model">{modelLabel(modelId)}</span>
                    {t ? (
                      <span className="opt-takes-view">
                        <SeverityIcon severity={t.severity} size={12} />
                        {t.change.type === "set-model" && typeof t.change.after === "string"
                          ? `Suggests ${getModel(t.change.after)?.label ?? t.change.after}`
                          : `${t.severity[0].toUpperCase() + t.severity.slice(1)} severity`}
                      </span>
                    ) : (
                      <span className="opt-takes-view">Didn't report this</span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <p className="opt-rec-meta">
            Found by the {CATEGORY_LABELS[r.category].toLowerCase()} evaluator{foundBy ? `, judged by ${modelLabel(foundBy)}` : ", using built-in rules"}.
          </p>
        </div>
      ) : null}
    </dialog>
  );
}
