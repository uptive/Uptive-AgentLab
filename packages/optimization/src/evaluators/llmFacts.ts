import type { EvaluationInput } from "../types.js";

/** Value as JSON (or the string itself), cut to `max` characters so prompts stay a manageable size. */
export function excerpt(value: unknown, max: number): unknown {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text === undefined || text.length <= max) return value;
  return `${text.slice(0, max)}… [${text.length - max} more characters]`;
}

/** The run's task: the `task` field of the first step's input, when there is one. */
export function runTask(input: EvaluationInput): unknown {
  const root = input.flow.nodes.find((n) => n.dependsOn.length === 0);
  const step = root && input.run.steps.find((s) => s.nodeId === root.id);
  return (step?.input as Record<string, unknown> | undefined)?.task ?? null;
}
