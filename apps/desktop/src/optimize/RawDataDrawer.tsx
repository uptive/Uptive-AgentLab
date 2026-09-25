import { useEffect, useRef, useState } from "react";
import type { EvaluationInput } from "@agentlab/optimization";
import { EVALUATOR_LABELS, callSummary, modelLabel, rawDataText, type ModelAnalysis } from "./analysis.js";

/**
 * Side drawer with what an analysis sent to the model and what came back, per evaluator call, plus
 * the full result. Can be copied or saved as a text file.
 */
export function RawDataDrawer({ analysis, input, onClose }: { analysis?: ModelAnalysis; input: EvaluationInput; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (analysis && !dialog.open) dialog.showModal();
    if (!analysis && dialog.open) dialog.close();
    setCopied(false);
  }, [analysis]);

  const text = analysis ? rawDataText(analysis, input) : "";

  function save() {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `analysis-${input.run.id.slice(0, 8)}-${analysis!.modelId}.txt`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
  }

  return (
    <dialog
      ref={ref}
      className="opt-drawer"
      aria-labelledby="opt-raw-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose(); // click on the backdrop
      }}
    >
      {analysis ? (
        <div className="opt-drawer-inner">
          <header className="opt-drawer-head">
            <div>
              <h2 id="opt-raw-title">Raw data</h2>
              <p className="hint">
                {input.flow.name} · analyzed with {modelLabel(analysis.modelId)} · {analysis.calls.length} model call
                {analysis.calls.length === 1 ? "" : "s"}
              </p>
            </div>
            <div className="opt-drawer-actions">
              <button className="opt-link" onClick={copy}>
                {copied ? "Copied" : "Copy all"}
              </button>
              <button className="opt-link" onClick={save}>
                Save as text file
              </button>
              <button className="opt-icon-button" aria-label="Close" onClick={onClose}>
                ×
              </button>
            </div>
          </header>

          {analysis.calls.length === 0 ? (
            <p className="hint">No model calls: every evaluator used its built-in rules.</p>
          ) : null}
          {analysis.calls.map((call, i) => (
            <section key={i} className="opt-raw-call">
              <h3>{EVALUATOR_LABELS[call.evaluatorId ?? ""] ?? call.evaluatorId ?? "Model call"}</h3>
              <p className="hint">{callSummary(call)}</p>
              {call.error ? <p className="opt-error">{call.error}</p> : <pre className="opt-raw-pre">{JSON.stringify(call.response, null, 2)}</pre>}
              <details>
                <summary>System prompt</summary>
                <pre className="opt-raw-pre">{call.system}</pre>
              </details>
              <details>
                <summary>Prompt (the run as the model saw it)</summary>
                <pre className="opt-raw-pre">{call.prompt}</pre>
              </details>
            </section>
          ))}
          {analysis.evaluation ? (
            <section className="opt-raw-call">
              <h3>Full result</h3>
              <p className="hint">All four evaluators, after the app checked and priced each finding.</p>
              <details>
                <summary>Show JSON</summary>
                <pre className="opt-raw-pre">{JSON.stringify(analysis.evaluation, null, 2)}</pre>
              </details>
            </section>
          ) : null}
        </div>
      ) : null}
    </dialog>
  );
}
