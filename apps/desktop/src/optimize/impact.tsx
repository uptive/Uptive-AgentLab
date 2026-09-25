import type { Recommendation } from "@agentlab/contracts";
import { seconds, signed } from "./format.js";

/**
 * What a change costs before it pays off: a higher step cost or a slower run. Shown in the warning
 * color next to the gain, so a better end result never hides that something gets worse first.
 */
function tradeOff(r: Recommendation): string | undefined {
  const { cost, speed } = r.estimatedImpact;
  const parts = [
    cost && cost.percent > 0 ? `+${cost.percent}% cost` : undefined,
    speed && speed.latencyMs > 0 ? `${signed(seconds(speed.latencyMs), speed.latencyMs)} run` : undefined,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
}

/**
 * The one number that best describes a recommendation, leading with what you gain: a cost saving,
 * then time saved, then retries avoided. A cost increase is shown only when there's no gain.
 */
function headlineImpact(r: Recommendation): { text: string; gain: boolean } {
  const { cost, speed, reliability } = r.estimatedImpact;
  if (cost && cost.percent < 0) return { text: `−${Math.abs(cost.percent)}% cost`, gain: true };
  if (speed && speed.latencyMs < 0) return { text: `${signed(seconds(speed.latencyMs), speed.latencyMs)} run`, gain: true };
  if (reliability) return { text: `−${reliability.retriesAvoided} retr${reliability.retriesAvoided === 1 ? "y" : "ies"}`, gain: true };
  if (cost) return { text: `+${cost.percent}% cost`, gain: false };
  return { text: "", gain: false };
}

type ImpactPart = { text: string; effect: "gain" | "tradeoff" | "neutral" };

/**
 * Splits a numeric impact summary ("Removes 1 retry, run 11.1s faster, +100% step cost") into its
 * parts and marks each as a gain or a trade-off. Plain sentences (quality findings) stay neutral.
 */
function impactParts(summary: string): ImpactPart[] {
  const isList = /\d/.test(summary) && !/[.!?]$/.test(summary.trim());
  if (!isList) return [{ text: summary, effect: "neutral" }];
  return summary.split(/,\s+/).map((text) => ({
    text,
    effect: /(^|\s)\+\d|slower|more expensive/i.test(text) ? "tradeoff" : /faster|fewer|reduction|−\d|removes|saves/i.test(text) ? "gain" : "neutral",
  }));
}

export function ImpactSummary({ summary }: { summary: string }) {
  const parts = impactParts(summary);
  return (
    <>
      {parts.map((p, i) => (
        <span key={i} className={`opt-effect ${p.effect}`}>
          {p.effect === "tradeoff" ? <span className="sr-only">Trade-off: </span> : null}
          {p.text}
          {i < parts.length - 1 ? ", " : ""}
        </span>
      ))}
    </>
  );
}

/** The headline effect of a recommendation: its gain (with any trade-off), or its quality risk. */
export function Impact({ recommendation }: { recommendation: Recommendation }) {
  const { text, gain } = headlineImpact(recommendation);
  const cost = tradeOff(recommendation);
  const { quality } = recommendation.estimatedImpact;
  if (!text && quality) {
    // No time or cost effect: it improves the output. Its risk level is the severity icon shown with it.
    return <span className="opt-impact risk">Quality fix</span>;
  }
  if (gain && cost) {
    return (
      <span className="opt-impact">
        {text}
        <span className="opt-effect tradeoff" title="Gets worse first: this is what the change costs">
          {" "}
          · <span className="sr-only">Trade-off: </span>
          {cost}
        </span>
      </span>
    );
  }
  return <span className={`opt-impact${gain ? "" : " tradeoff"}`}>{text}</span>;
}
