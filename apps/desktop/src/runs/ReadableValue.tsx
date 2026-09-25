import { useState } from "react";
import { theme } from "../theme.js";
import { contentBlocksText, humanizeKey } from "./readable.js";

// Shows any value the way a person would write it down: text as text, objects as labelled
// fields and lists as lists. Used instead of a JSON tree wherever a run's data is shown.

const MAX_DEPTH = 4;
const LONG_TEXT = 600;

function LongText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > LONG_TEXT;
  return (
    <div>
      <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.5 }}>
        {long && !expanded ? `${text.slice(0, LONG_TEXT).trimEnd()}…` : text}
      </div>
      {long ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          style={{ background: "none", border: "none", padding: 0, marginTop: 2, color: theme.primary, cursor: "pointer", fontSize: 12 }}
        >
          {expanded ? "Show less" : `Show all (${text.length.toLocaleString()} characters)`}
        </button>
      ) : null}
    </div>
  );
}

const muted = { color: theme.textMuted };

export function ReadableValue({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value === undefined || value === null || value === "") return <span style={muted}>Nothing</span>;
  if (typeof value === "string") return <LongText text={value} />;
  if (typeof value === "number" || typeof value === "boolean") return <span>{String(value)}</span>;

  const blocksText = contentBlocksText(value);
  if (blocksText !== undefined) return <LongText text={blocksText} />;

  if (Array.isArray(value)) {
    if (value.length === 0) return <span style={muted}>None</span>;
    if (depth >= MAX_DEPTH) return <span style={muted}>{value.length} items</span>;
    if (value.every((item) => typeof item !== "object" || item === null) && value.join(", ").length < 120) {
      return <span>{value.join(", ")}</span>;
    }
    return (
      <ol style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6 }}>
        {value.map((item, index) => (
          <li key={index}>
            <ReadableValue value={item} depth={depth + 1} />
          </li>
        ))}
      </ol>
    );
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return <span style={muted}>Nothing</span>;
    if (depth >= MAX_DEPTH) return <span style={muted}>{entries.length} fields</span>;
    return (
      <div style={{ display: "grid", gridTemplateColumns: "minmax(80px, max-content) minmax(0, 1fr)", gap: "4px 12px" }}>
        {entries.map(([key, v]) => (
          <div key={key} style={{ display: "contents" }}>
            <div style={{ ...muted, fontSize: 12, paddingTop: 1 }}>{humanizeKey(key)}</div>
            <div style={{ minWidth: 0 }}>
              <ReadableValue value={v} depth={depth + 1} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return <span>{String(value)}</span>;
}
