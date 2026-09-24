import type { Run } from "@agentlab/contracts";
import workComplete from "./assets/sounds/work-complete.mp3";
import moreGold from "./assets/sounds/more-gold.mp3";

// Sound cues for real runs: "work complete" when a run finishes, "more gold is required" when it
// stops because Claude usage, credits, or the agent's own cost or token budget ran out.

const OUT_OF_TOKENS = /usage limit|billing|credit balance|cost limit|token limit/i;

const active = new Set<string>();

function play(src: string): void {
  const audio = new Audio(src);
  audio.volume = 0.8;
  // Autoplay can be refused (e.g. before any user interaction); a missing cue is not an error.
  void audio.play().catch(() => undefined);
}

/** Plays a cue when a run seen running reaches a final status. Runs loaded from disk stay silent. */
export function playRunSound(run: Run): void {
  if (run.status === "pending" || run.status === "running") {
    active.add(run.id);
    return;
  }
  if (!active.delete(run.id)) return;
  if (run.status === "completed") play(workComplete);
  else if (run.steps.some((step) => step.error && OUT_OF_TOKENS.test(step.error))) play(moreGold);
}
