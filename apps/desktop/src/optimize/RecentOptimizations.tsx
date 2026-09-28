import type { SavedOptimizationSummary } from "@agentlab/optimization";
import { modelLabel } from "./analysis.js";

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/** The most recent saved optimizations; opening one shows its full result again. */
export function RecentOptimizations({
  items,
  unreadable,
  loading,
  error,
  openId,
  onOpen,
}: {
  items: SavedOptimizationSummary[];
  unreadable: { file: string; reason: string }[];
  loading: boolean;
  error?: string;
  /** The one currently open, if any. */
  openId?: string;
  onOpen: (id: string) => void;
}) {
  return (
    <section className="opt-section opt-history" aria-labelledby="opt-history-title">
      <div className="opt-section-head">
        <h2 id="opt-history-title">Recent optimizations</h2>
        <span className="hint">The last 20, saved on this computer.</span>
      </div>
      {error ? <p className="opt-error">{error}</p> : null}
      {unreadable.length ? (
        <p className="opt-notice">
          {unreadable.length} saved optimization{unreadable.length === 1 ? "" : "s"} couldn't be read: {unreadable.map((u) => u.reason).join("; ")}
        </p>
      ) : null}
      {loading && items.length === 0 ? <p className="hint">Loading…</p> : null}
      {!loading && !error && items.length === 0 ? <p className="hint">Analyze a run and the result is saved here, so you can come back to it.</p> : null}
      {items.length ? (
        <ul className="opt-history-list">
          {items.map((o) => (
            <li key={o.id}>
              <button className="opt-history-item" aria-current={o.id === openId ? "true" : undefined} onClick={() => onOpen(o.id)}>
                <span className="opt-history-main">
                  <strong>{o.flowName}</strong>
                  <span className="hint">
                    {when(o.createdAt)} · {o.modelIds.map(modelLabel).join(", ")}
                  </span>
                </span>
                <span className="opt-history-stats">
                  <span>
                    {o.recommendations} recommendation{o.recommendations === 1 ? "" : "s"}
                    {o.highSeverity ? <span className="opt-history-high"> · {o.highSeverity} high</span> : null}
                  </span>
                  {o.savedUsdPerRun > 0.00005 ? <span className="opt-history-gain">−${o.savedUsdPerRun.toFixed(4)} per run</span> : null}
                  {o.applied ? <span className="opt-state applied">{o.applied} applied</span> : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
