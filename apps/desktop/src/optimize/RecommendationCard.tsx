import type { Recommendation } from "@agentlab/contracts";
import { SeverityIcon, TagIcon } from "./badges.js";
import { withInlineCode } from "./format.js";
import { Impact } from "./impact.js";

export const STATE_LABELS = { "in-test": "In test", applied: "Applied" } as const;
export type CardState = keyof typeof STATE_LABELS;

/** What a card needs to be picked for a test run. */
export interface CardPick {
  picked: boolean;
  /** Why it can't be picked right now; the checkbox is off while set. */
  blocker?: string;
  onPick: () => void;
}

/**
 * One suggestion at a glance: which step, what to do, and what it gains or costs. Everything else
 * lives in the drawer that opens on click. The checkbox picks it for a test run.
 */
export function RecommendationCard({
  recommendation: r,
  step,
  pick,
  state,
  onOpen,
  context,
}: {
  recommendation: Recommendation;
  /** Name of the step (agent) it's about. */
  step: string;
  pick: CardPick;
  state?: CardState;
  onOpen: () => void;
  /** Extra line under the step, e.g. the category when cards of several categories sit together. */
  context?: string;
}) {
  const id = `card-${r.id}-${step}`.replace(/[^\w-]/g, "_");
  return (
    <article className={`opt-card sev-${r.severity}${pick.picked ? " is-picked" : ""}${state ? ` is-${state}` : ""}`}>
      <label className="opt-card-pick" title={pick.blocker ?? "Include this change in a test run"}>
        <input
          type="checkbox"
          checked={pick.picked}
          disabled={Boolean(pick.blocker) && !pick.picked}
          onChange={pick.onPick}
          aria-label={`Test "${r.title}"`}
          aria-describedby={pick.blocker ? `${id}-blocker` : undefined}
        />
        {pick.blocker ? (
          <span id={`${id}-blocker`} hidden>
            {pick.blocker}
          </span>
        ) : null}
      </label>
      <button className="opt-card-body" onClick={onOpen} aria-haspopup="dialog">
        <span className="opt-card-top">
          <SeverityIcon severity={r.severity} size={12} />
          <span className="opt-card-step">
            {step}
            {context ? <span className="opt-card-context"> · {context}</span> : null}
          </span>
          {state ? <span className={`opt-state ${state === "applied" ? "applied" : "running"}`}>{STATE_LABELS[state]}</span> : null}
        </span>
        <span className="opt-card-title">{withInlineCode(r.title)}</span>
        <span className="opt-card-foot">
          <Impact recommendation={r} />
          {r.tags?.length ? (
            <span className="opt-card-tags">
              {r.tags.map((tag) => (
                <span key={tag} className="opt-card-tag" title={tag}>
                  <TagIcon tag={tag} size={13} />
                  <span className="sr-only">{tag}</span>
                </span>
              ))}
            </span>
          ) : null}
        </span>
      </button>
    </article>
  );
}
