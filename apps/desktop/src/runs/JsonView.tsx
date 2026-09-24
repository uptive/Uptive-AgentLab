import { useState, type CSSProperties, type ReactNode } from "react";
import { theme } from "../theme.js";

// Collapsible, readable JSON: objects and arrays fold, and long or multi-line strings (diffs,
// prompts, file contents) render as real text instead of one escaped line.

const LONG_STRING = 80;

const box: CSSProperties = {
  position: "relative",
  background: theme.codeBg,
  border: `1px solid ${theme.border}`,
  borderRadius: 6,
  padding: "8px 10px",
  fontFamily: theme.fontMono,
  fontSize: 12,
  lineHeight: 1.55,
  overflow: "auto",
  maxHeight: 360,
};

const keyColor = { color: theme.primary };
const punct = { color: theme.textMuted };

function isContainer(value: unknown): value is Record<string, unknown> | unknown[] {
  return typeof value === "object" && value !== null;
}

function summary(value: Record<string, unknown> | unknown[]): string {
  if (Array.isArray(value)) return `[ ${value.length} ${value.length === 1 ? "item" : "items"} ]`;
  const keys = Object.keys(value);
  const preview = keys.slice(0, 4).join(", ");
  return `{ ${preview}${keys.length > 4 ? `, … +${keys.length - 4}` : ""} }`;
}

function Scalar({ value }: { value: unknown }) {
  if (typeof value === "string") {
    if (value.includes("\n") || value.length > LONG_STRING) {
      return (
        <div
          style={{
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            color: theme.text,
            borderLeft: `2px solid ${theme.border}`,
            padding: "2px 0 2px 8px",
            margin: "2px 0",
          }}
        >
          {value}
        </div>
      );
    }
    return <span style={{ color: theme.statusActive }}>"{value}"</span>;
  }
  if (typeof value === "number") return <span style={{ color: theme.warning }}>{value}</span>;
  if (typeof value === "boolean") return <span style={{ color: theme.warning }}>{String(value)}</span>;
  if (value === null) return <span style={punct}>null</span>;
  return <span style={punct}>{String(value)}</span>;
}

function Node({ name, value, depth, openDepth }: { name?: string; value: unknown; depth: number; openDepth: number }) {
  const [open, setOpen] = useState(depth < openDepth);
  const label: ReactNode = name !== undefined ? <span style={keyColor}>{name}: </span> : null;

  if (!isContainer(value)) {
    const block = typeof value === "string" && (value.includes("\n") || value.length > LONG_STRING);
    return (
      <div style={{ paddingLeft: depth ? 14 : 0 }}>
        {label}
        {block ? null : <Scalar value={value} />}
        {block ? <Scalar value={value} /> : null}
      </div>
    );
  }

  const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value);
  if (entries.length === 0) {
    return (
      <div style={{ paddingLeft: depth ? 14 : 0 }}>
        {label}
        <span style={punct}>{Array.isArray(value) ? "[]" : "{}"}</span>
      </div>
    );
  }

  return (
    <div style={{ paddingLeft: depth ? 14 : 0 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{ background: "none", border: "none", padding: 0, font: "inherit", color: "inherit", cursor: "pointer", textAlign: "left" }}
        aria-expanded={open}
      >
        <span style={{ ...punct, display: "inline-block", width: 12 }}>{open ? "▾" : "▸"}</span>
        {label}
        {open ? null : <span style={punct}>{summary(value)}</span>}
      </button>
      {open ? entries.map(([key, child]) => <Node key={key} name={Array.isArray(value) ? undefined : key} value={child} depth={depth + 1} openDepth={openDepth} />) : null}
    </div>
  );
}

/** JSON viewer. `openDepth` levels are expanded initially; deeper levels start folded. */
export function JsonView({ value, openDepth = 2, maxHeight }: { value: unknown; openDepth?: number; maxHeight?: number }) {
  const [copied, setCopied] = useState(false);
  if (value === undefined) return <div style={{ ...box, color: theme.textMuted }}>—</div>;
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);

  return (
    <div style={{ ...box, ...(maxHeight ? { maxHeight } : {}) }}>
      <button
        type="button"
        onClick={() => void navigator.clipboard.writeText(text).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1200)))}
        title="Copy as JSON"
        style={{
          position: "sticky",
          float: "right",
          top: 0,
          background: theme.surface,
          border: `1px solid ${theme.border}`,
          borderRadius: 4,
          color: theme.textMuted,
          fontSize: 11,
          padding: "1px 6px",
          cursor: "pointer",
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
      <Node value={value} depth={0} openDepth={openDepth} />
    </div>
  );
}
