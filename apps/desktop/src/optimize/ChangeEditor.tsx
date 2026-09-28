import { useEffect, useState } from "react";
import type { ChangeType, RecommendationChange } from "@agentlab/contracts";

/** Changes whose new value is text (or JSON) a person can rewrite before testing or applying it. */
const EDITABLE: Partial<Record<ChangeType, "text" | "json">> = {
  "edit-instructions": "text",
  "edit-role": "text",
  "extend-run-input": "json",
  "add-output-schema": "json",
};

export const isEditableChange = (change: RecommendationChange) => EDITABLE[change.type] !== undefined;

const toText = (value: unknown, kind: "text" | "json") =>
  kind === "text" ? (typeof value === "string" ? value : "") : JSON.stringify(value ?? {}, null, 2);

/** Edit the suggested value in place. Saving replaces the suggestion for testing and applying. */
export function ChangeEditor({
  change,
  edited,
  onSave,
  onReset,
  onDirtyChange,
}: {
  change: RecommendationChange;
  /** True when `change.after` is the user's version, not the evaluator's. */
  edited: boolean;
  onSave: (after: unknown) => void;
  onReset: () => void;
  /** Told whether an unsaved draft is open, so closing the drawer can ask first. */
  onDirtyChange: (dirty: boolean) => void;
}) {
  const kind = EDITABLE[change.type];
  const [draft, setDraft] = useState<string>();
  const [error, setError] = useState<string>();

  // A different recommendation (or a reset) discards the open draft.
  useEffect(() => {
    setDraft(undefined);
    setError(undefined);
  }, [change]);

  const dirty = draft !== undefined && kind !== undefined && draft !== toText(change.after, kind);
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  if (!kind) return null;

  function save() {
    if (draft === undefined || !kind) return;
    if (kind === "text") {
      onSave(draft);
      return;
    }
    try {
      const value: unknown = JSON.parse(draft);
      if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Enter a JSON object, e.g. { \"field\": \"value\" }.");
      onSave(value);
    } catch (e) {
      setError(e instanceof SyntaxError ? `Not valid JSON: ${e.message}` : e instanceof Error ? e.message : String(e));
    }
  }

  if (draft === undefined) {
    return (
      <div className="opt-editor-actions">
        <button className="opt-link" onClick={() => setDraft(toText(change.after, kind))}>
          Edit this change
        </button>
        {edited ? (
          <>
            <span className="hint">Edited by you.</span>
            <button className="opt-link" onClick={onReset}>
              Use the suggestion again
            </button>
          </>
        ) : null}
      </div>
    );
  }

  return (
    <div className="opt-editor">
      <textarea
        aria-label="New value"
        value={draft}
        spellCheck={kind === "text"}
        rows={Math.min(24, Math.max(6, draft.split("\n").length + 1))}
        onChange={(e) => {
          setDraft(e.target.value);
          setError(undefined);
        }}
      />
      {error ? <p className="opt-error">{error}</p> : null}
      <div className="opt-editor-actions">
        <button className="opt-primary" onClick={save}>
          Save change
        </button>
        <button className="opt-link" onClick={() => setDraft(undefined)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
