import { RECOMMENDATION_TAGS, type RecommendationTag } from "@agentlab/contracts";

/** Appended to every model-backed evaluator's system prompt. */
export const TAG_INSTRUCTIONS = `Also give each finding 0 or more tags from this fixed list: ${RECOMMENDATION_TAGS.join(", ")}. Tags describe the dimension a finding affects, separate from which evaluator found it (for example Cost can apply to a model finding and to a context finding). Only include tags that genuinely apply. Don't force one from every category, and don't invent new tags.`;

/** JSON Schema for a finding's `tags` field. */
export const TAGS_SCHEMA = { type: "array", items: { type: "string", enum: [...RECOMMENDATION_TAGS] } };

/** Known tags from `values`, deduplicated and in the canonical order. Unknown values are dropped. */
export function toTags(...values: unknown[][]): RecommendationTag[] {
  const given = new Set(values.flat());
  return RECOMMENDATION_TAGS.filter((tag) => given.has(tag));
}
