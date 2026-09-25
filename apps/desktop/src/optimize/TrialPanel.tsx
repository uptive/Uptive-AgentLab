import { useState } from "react";
import type { Run, StepRun } from "@agentlab/contracts";
import { FIELD_LABELS, getModel, type ChangePlan, type EvaluationInput, type PlannedEdit } from "@agentlab/optimization";
import type { ApplyResult, Destination, FlowLocation } from "./trial.js";

/** The test of a set of changes, from start to applied. */
export interface TrialState {
  plan: ChangePlan;
  recommendationIds: string[];
  /** Live snapshot of the test run; its final state once finished. */
  run?: Run;
  error?: string;
  review?: { destinations: Destination[]; flow?: FlowLocation };
  applying?: boolean;
  results?: ApplyResult[];
}

// ---- Values -------------------------------------------------------------------------------------

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "(none)";
  if (typeof value === "string") return getModel(value)?.label ?? value;
  if (Array.isArray(value) && value.every((v) => typeof v === "string")) return value.length ? value.join(", ") : "(nothing)";
  return JSON.stringify(value, null, 2);
}

const isShort = (value: unknown) => {
  const text = formatValue(value);
  return text.length <= 48 && !text.includes("\n");
};

/** Before → after: inline for short values, collapsible side by side for long ones. */
function ValueChange({ before, after }: { before: unknown; after: unknown }) {
  if (isShort(before) && isShort(after)) {
    return (
      <span className="opt-change-inline">
        <span className="before">{formatValue(before)}</span>
        <span aria-label="becomes">→</span>
        <span className="after">{formatValue(after)}</span>
      </span>
    );
  }
  return (
    <details className="opt-value-details">
      <summary>Show before and after</summary>
      <div className="opt-change-blocks">
        <figure className="before">
          <figcaption>Before</figcaption>
          <pre>{formatValue(before)}</pre>
        </figure>
        <figure className="after">
          <figcaption>After</figcaption>
          <pre>{formatValue(after)}</pre>
        </figure>
      </div>
    </details>
  );
}

function editWhere(edit: PlannedEdit): string {
  return edit.target.kind === "run-input" ? "Run input" : edit.target.kind === "agent" ? `${edit.target.name} (agent)` : `${edit.target.name} (step)`;
}

/** Every field a plan changes: where, which field, before → after. */
export function EditList({ edits }: { edits: PlannedEdit[] }) {
  return (
    <ul className="opt-edits">
      {edits.map((edit) => (
        <li key={`${edit.recommendationId}:${edit.field}`}>
          <span className="opt-edit-where">{editWhere(edit)}</span>
          <span className="opt-edit-field">{FIELD_LABELS[edit.field]}</span>
          <ValueChange before={edit.before} after={edit.after} />
        </li>
      ))}
    </ul>
  );
}

// ---- Stage 0: choosing ----------------------------------------------------------------------------

/** Pinned to the bottom while changes are selected: what the test will change, and the button to run it. */
export function ChangeTray({
  plan,
  onTest,
  onClear,
  busy,
}: {
  plan: ChangePlan;
  onTest: () => void;
  onClear: () => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const count = plan.edits.length;
  return (
    <div className="opt-tray" role="region" aria-label="Changes to test">
      <div className="opt-tray-bar">
        <button className="opt-tray-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <strong>
            {count} change{count === 1 ? "" : "s"} selected
          </strong>
          <span className="hint">Tested on copies. Your agents and flows stay as they are until you apply.</span>
        </button>
        <button className="opt-link" onClick={onClear}>
          Clear
        </button>
        <button className="opt-primary" disabled={busy || count === 0} onClick={onTest}>
          Test {count === 1 ? "change" : "changes"}
        </button>
      </div>
      {open ? <EditList edits={plan.edits} /> : null}
    </div>
  );
}

// ---- Stage 1 and 2: testing and applying ----------------------------------------------------------

const usd = (v: number) => `$${v.toFixed(4)}`;
const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/** When a step started, counted from the start of its run. */
function startedAt(run: Run, step: StepRun | undefined): number | undefined {
  return step?.startedAt ? Date.parse(step.startedAt) - Date.parse(run.startedAt) : undefined;
}

/** "a → b", with the new value marked better or worse when it moved by at least half a second. */
function TimeChange({ before, after }: { before?: number; after?: number }) {
  const moved = before !== undefined && after !== undefined && Math.abs(after - before) >= 500;
  return (
    <>
      {before !== undefined ? secs(before) : "–"} →{" "}
      <span className={moved ? (after! < before! ? "better" : "worse") : undefined}>{after !== undefined ? secs(after) : "–"}</span>
    </>
  );
}

function delta(before: number, after: number, format: (v: number) => string): { text: string; better?: boolean } {
  if (!before) return { text: "" };
  const pct = Math.round(((after - before) / before) * 100);
  if (pct === 0) return { text: "same" };
  return { text: `${pct < 0 ? "−" : "+"}${Math.abs(pct)}% (${pct < 0 ? "−" : "+"}${format(Math.abs(after - before))})`, better: pct < 0 };
}

function runTotals(run: Run) {
  const steps = run.steps;
  const tokens = steps.reduce((sum, s) => sum + (s.usage ? s.usage.inputTokens + s.usage.outputTokens : 0), 0);
  const cost = run.totalUsage?.estimatedCostUsd ?? steps.reduce((sum, s) => sum + (s.usage?.estimatedCostUsd ?? 0), 0);
  const latency = run.totalUsage?.latencyMs ?? (run.completedAt ? Date.parse(run.completedAt) - Date.parse(run.startedAt) : 0);
  return { tokens, cost, latency, failed: steps.filter((s) => s.status === "failed").length };
}

/** Outputs of the steps nothing else depends on: what the run produced. */
function finalOutputs(run: Run, nodes: { id: string; dependsOn: string[] }[]): Record<string, unknown> {
  const terminal = nodes.filter((n) => !nodes.some((m) => m.dependsOn.includes(n.id)));
  return Object.fromEntries(terminal.map((n) => [n.id, run.steps.find((s) => s.nodeId === n.id)?.output ?? null]));
}

const STATUS_TEXT: Record<StepRun["status"], string> = { pending: "Waiting", running: "Running…", completed: "Done", failed: "Failed" };

export function TrialPanel({
  trial,
  base,
  onApply,
  onConfirmApply,
  onCancelApply,
  onDiscard,
}: {
  trial: TrialState;
  base: EvaluationInput;
  onApply: () => void;
  onConfirmApply: () => void;
  onCancelApply: () => void;
  onDiscard: () => void;
}) {
  const { plan, run, error, review, results } = trial;
  const finished = run && (run.status === "completed" || run.status === "failed");
  const applied = Boolean(results);
  const stateLabel = applied ? "Applied" : error ? "Test didn't start" : !finished ? "Testing…" : run!.status === "failed" ? "Test run failed · not applied" : "Tested · not applied";
  const nameOf = (nodeId: string) => {
    const node = plan.flow.nodes.find((n) => n.id === nodeId);
    return node?.label ?? plan.agents.find((a) => a.id === node?.agentId)?.name ?? nodeId;
  };
  const modelOf = (agents: EvaluationInput["agents"], nodeId: string) => {
    const agentId = plan.flow.nodes.find((n) => n.id === nodeId)?.agentId;
    const model = agents.find((a) => a.id === agentId)?.model;
    return model ? (getModel(model)?.label ?? model) : "";
  };

  return (
    <section className={`opt-section opt-trial${applied ? " is-applied" : ""}`} aria-labelledby="opt-trial-title">
      <div className="opt-section-head">
        <h2 id="opt-trial-title">Test of {plan.edits.length} change{plan.edits.length === 1 ? "" : "s"}</h2>
        <span className={`opt-state ${applied ? "applied" : finished && run!.status === "completed" ? "tested" : error || run?.status === "failed" ? "failed" : "running"}`}>
          {stateLabel}
        </span>
      </div>
      <p className="opt-trial-lede">
        {applied
          ? "These changes are now saved. Future runs use them."
          : "The flow ran once with the changes below, on copies of your agents and flow. Nothing is saved until you apply."}
      </p>

      <h3 className="opt-subhead">{applied ? "What changed" : "What's changed in this test"}</h3>
      <EditList edits={plan.edits} />

      {error ? <p className="opt-error">{error}</p> : null}

      {run && !finished ? (
        <ul className="opt-trial-steps" aria-live="polite">
          {run.steps.map((s) => (
            <li key={s.id} className={`is-${s.status}`}>
              <span className="name">{nameOf(s.nodeId)}</span>
              <span className="detail">
                {STATUS_TEXT[s.status]}
                {s.usage ? ` · ${secs(s.usage.latencyMs)}` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {run && finished ? <Comparison base={base} run={run} plan={plan} nameOf={nameOf} modelOf={modelOf} /> : null}

      {run && finished && !applied ? (
        review ? (
          <ApplyReview review={review} applying={Boolean(trial.applying)} onConfirm={onConfirmApply} onCancel={onCancelApply} />
        ) : (
          <div className="opt-trial-actions">
            <button className="opt-primary" onClick={onApply} disabled={run.status !== "completed"}>
              Review and apply…
            </button>
            <button className="opt-link" onClick={onDiscard}>
              Discard test
            </button>
            {run.status !== "completed" ? <span className="hint">Applying is off because the test run failed.</span> : null}
          </div>
        )
      ) : null}

      {results ? <ApplyResults results={results} destinations={review?.destinations ?? []} onDone={onDiscard} /> : null}
    </section>
  );
}

function Comparison({
  base,
  run,
  plan,
  nameOf,
  modelOf,
}: {
  base: EvaluationInput;
  run: Run;
  plan: ChangePlan;
  nameOf: (nodeId: string) => string;
  modelOf: (agents: EvaluationInput["agents"], nodeId: string) => string;
}) {
  const [a, b] = [runTotals(base.run), runTotals(run)];
  const rows = [
    { label: "Run time", before: secs(a.latency), after: secs(b.latency), d: delta(a.latency, b.latency, secs) },
    { label: "Cost (estimated)", before: usd(a.cost), after: usd(b.cost), d: delta(a.cost, b.cost, usd) },
    { label: "Tokens", before: a.tokens.toLocaleString("en-US"), after: b.tokens.toLocaleString("en-US"), d: delta(a.tokens, b.tokens, (v) => v.toLocaleString("en-US")) },
    { label: "Failed steps", before: String(a.failed), after: String(b.failed), d: { text: b.failed > a.failed ? "worse" : b.failed < a.failed ? "better" : "", better: b.failed <= a.failed ? undefined : false } },
  ];
  const [outBefore, outAfter] = [finalOutputs(base.run, base.flow.nodes), finalOutputs(run, plan.flow.nodes)];
  return (
    <>
      <h3 className="opt-subhead">Result</h3>
      <p className="hint">
        Both columns are single runs, and together they reflect every tested change at once. Model response times vary between runs, so treat
        small differences as noise.
      </p>
      <div className="opt-table-wrap">
        <table className="opt-compare">
          <thead>
            <tr>
              <th scope="col" />
              <th scope="col">Original run</th>
              <th scope="col">With changes</th>
              <th scope="col">Difference</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <th scope="row">{r.label}</th>
                <td>{r.before}</td>
                <td>{r.after}</td>
                <td className={r.d.better === true ? "better" : r.d.better === false ? "worse" : ""}>{r.d.text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="opt-table-wrap">
        <table className="opt-compare opt-compare-steps">
          <thead>
            <tr>
              <th scope="col">Step</th>
              <th scope="col">Model</th>
              <th scope="col">
                <abbr title="Seconds into the run when the step started. Running steps in parallel moves this earlier.">Started</abbr>
              </th>
              <th scope="col">
                <abbr title="How long the step itself ran.">Took</abbr>
              </th>
              <th scope="col">Cost</th>
            </tr>
          </thead>
          <tbody>
            {plan.flow.nodes.map((node) => {
              const [s0, s1] = [base.run.steps.find((s) => s.nodeId === node.id), run.steps.find((s) => s.nodeId === node.id)];
              const [m0, m1] = [modelOf(base.agents, node.id), modelOf(plan.agents, node.id)];
              return (
                <tr key={node.id}>
                  <th scope="row">
                    {nameOf(node.id)}
                    {s1?.status === "failed" ? <span className="opt-failed"> failed</span> : null}
                  </th>
                  <td>{m0 === m1 ? m1 : <ValueChange before={m0} after={m1} />}</td>
                  <td>
                    <TimeChange before={startedAt(base.run, s0)} after={startedAt(run, s1)} />
                  </td>
                  <td>
                    <TimeChange before={s0?.usage?.latencyMs} after={s1?.usage?.latencyMs} />
                  </td>
                  <td>
                    {s0?.usage ? usd(s0.usage.estimatedCostUsd) : "–"} → {s1?.usage ? usd(s1.usage.estimatedCostUsd) : "–"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <details className="opt-value-details">
        <summary>Compare the final output</summary>
        <div className="opt-change-blocks">
          <figure className="before">
            <figcaption>Original run</figcaption>
            <pre>{JSON.stringify(outBefore, null, 2)}</pre>
          </figure>
          <figure className="after">
            <figcaption>With changes</figcaption>
            <pre>{JSON.stringify(outAfter, null, 2)}</pre>
          </figure>
        </div>
      </details>
    </>
  );
}

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function ApplyReview({
  review,
  applying,
  onConfirm,
  onCancel,
}: {
  review: { destinations: Destination[] };
  applying: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const saveable = review.destinations.filter((d) => !d.unavailable);
  return (
    <div className="opt-apply" role="group" aria-labelledby="opt-apply-title">
      <h3 id="opt-apply-title" className="opt-subhead">
        Apply these changes?
      </h3>
      <p className="hint">Each change is saved where the agent or flow lives. Nothing else in them changes.</p>
      <ul className="opt-edits">
        {review.destinations.map((d) => {
          const drifted = !d.unavailable && !sameValue(d.current, d.edit.before);
          return (
            <li key={`${d.edit.recommendationId}:${d.edit.field}`} className={d.unavailable ? "is-unavailable" : ""}>
              <span className="opt-edit-where">{editWhere(d.edit)}</span>
              <span className="opt-edit-field">{FIELD_LABELS[d.edit.field]}</span>
              <ValueChange before={d.unavailable ? d.edit.before : d.current} after={d.edit.after} />
              <span className="opt-edit-dest">{d.unavailable ? `Won't be saved: ${d.unavailable}` : `Saves to: ${d.where}`}</span>
              {drifted ? <span className="opt-edit-warn">Changed since the run. Applying replaces the current value shown above.</span> : null}
            </li>
          );
        })}
      </ul>
      <div className="opt-trial-actions">
        <button className="opt-primary" disabled={applying || saveable.length === 0} onClick={onConfirm}>
          {applying ? "Applying…" : `Apply ${saveable.length} change${saveable.length === 1 ? "" : "s"}`}
        </button>
        <button className="opt-link" onClick={onCancel} disabled={applying}>
          Back
        </button>
      </div>
    </div>
  );
}

function ApplyResults({ results, destinations, onDone }: { results: ApplyResult[]; destinations: Destination[]; onDone: () => void }) {
  const failed = results.filter((r) => !r.ok);
  const notSaved = destinations.filter((d) => d.unavailable);
  return (
    <div className="opt-apply" aria-live="polite">
      <ul className="opt-results">
        {results.map((r) => (
          <li key={`${r.edit.recommendationId}:${r.edit.field}`} className={r.ok ? "ok" : "failed"}>
            <span aria-hidden="true">{r.ok ? "✓" : "×"}</span>
            {editWhere(r.edit)} · {FIELD_LABELS[r.edit.field]}
            {r.ok ? ` saved to ${destinations.find((d) => d.edit === r.edit)?.where?.toLowerCase() ?? "its store"}` : ` not saved: ${r.error}`}
          </li>
        ))}
        {notSaved.map((d) => (
          <li key={`${d.edit.recommendationId}:${d.edit.field}`} className="skipped">
            <span aria-hidden="true">–</span>
            {editWhere(d.edit)} · {FIELD_LABELS[d.edit.field]} not saved: {d.unavailable}
          </li>
        ))}
      </ul>
      {failed.length === 0 ? <p className="hint">Analyze a new run to see the effect on the next real run.</p> : null}
      <div className="opt-trial-actions">
        <button className="opt-link" onClick={onDone}>
          Close
        </button>
      </div>
    </div>
  );
}
