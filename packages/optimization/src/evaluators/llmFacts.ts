import type { EvaluationInput } from "../types.js";

/** Value as JSON (or the string itself), cut to `max` characters so prompts stay a manageable size. */
export function excerpt(value: unknown, max: number): unknown {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text === undefined || text.length <= max) return value;
  return `${text.slice(0, max)}… [${text.length - max} more characters]`;
}

/** The run's task: its `task` field when it has one, otherwise the whole run input (e.g. title, description, diff). */
export function runTask(input: EvaluationInput): unknown {
  const root = input.flow.nodes.find((n) => n.dependsOn.length === 0);
  const runInput = input.run.input ?? (root && input.run.steps.find((s) => s.nodeId === root.id)?.input);
  const task = (runInput as Record<string, unknown> | undefined)?.task;
  return excerpt(task ?? runInput ?? null, 4000);
}
