import type { ChangeType, Recommendation, RecommendationCategory, RecommendationChange } from "@agentlab/contracts";
import type { EvaluationInput } from "@agentlab/optimization";

export const CATEGORY_LABELS: Record<RecommendationCategory, string> = {
  quality: "Quality",
  "model-selection": "Model selection",
  "token-context": "Token & context",
  "flow-design": "Flow design",
};

export const CHANGE_LABELS: Record<ChangeType, string> = {
  "set-model": "Model change",
  "remove-input": "Input trimming",
  "replace-input": "Input trimming",
  "add-output-schema": "Output schema",
  "edit-instructions": "Instructions",
  "extend-run-input": "Run input",
  "set-dependencies": "Dependency change",
  "add-node": "New step",
  "merge-nodes": "Merge steps",
  "edit-role": "Role change",
  "edit-input-mapping": "Input mapping",
};

export function usd(value: number): string {
  return `$${Math.abs(value).toFixed(4)}`;
}

export function seconds(ms: number): string {
  return `${(Math.abs(ms) / 1000).toFixed(1)}s`;
}

export function signed(text: string, value: number): string {
  return `${value < 0 ? "−" : "+"}${text}`;
}

export function percentChange(before: number, after: number): string {
  const percent = Math.round(((after - before) / before) * 100);
  return `${percent < 0 ? "−" : "+"}${Math.abs(percent)}%`;
}

/** The step (agent name) or "Whole flow" a recommendation is about. */
export function targetName(input: EvaluationInput, r: Recommendation): string {
  if (r.target.kind === "flow") return "Whole flow";
  const { agentId } = r.target;
  const node = r.target.kind === "node" ? input.flow.nodes.find((n) => n.id === (r.target as { nodeId: string }).nodeId) : undefined;
  return node?.label ?? input.agents.find((a) => a.id === agentId)?.name ?? agentId;
}

/** Renders `backtick` spans from evaluator text as <code>. */
export function withInlineCode(text: string) {
  return text.split(/`([^`]+)`/).map((part, i) => (i % 2 ? <code key={i}>{part}</code> : part));
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "(none)";
  if (Array.isArray(value) && value.every((v) => typeof v === "string")) return `[${value.join(", ")}]`;
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function isInline(value: unknown): boolean {
  const text = formatValue(value);
  return text.length <= 60 && !text.includes("\n");
}

/** Before → after for a structured change: inline for short values, side by side for long ones. */
export function ChangeDiff({ change }: { change: RecommendationChange }) {
  const path = <span className="opt-change-path">{change.path}</span>;
  if (isInline(change.before) && isInline(change.after)) {
    return (
      <>
        {path}
        <span className="opt-change-inline">
          <span className="before">{formatValue(change.before)}</span>
          <span aria-label="becomes">→</span>
          <span className="after">{change.after === null ? "(removed)" : formatValue(change.after)}</span>
        </span>
      </>
    );
  }
  return (
    <>
      {path}
      <div className="opt-change-blocks">
        <figure className="before">
          <figcaption>Before</figcaption>
          <pre>{formatValue(change.before)}</pre>
        </figure>
        <figure className="after">
          <figcaption>After</figcaption>
          <pre>{formatValue(change.after)}</pre>
        </figure>
      </div>
    </>
  );
}
