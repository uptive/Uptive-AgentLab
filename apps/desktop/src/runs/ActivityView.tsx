import { useEffect, useRef, useState } from "react";
import type { ActivityBlock } from "../liveRuns.js";
import { theme } from "../theme.js";
import { JsonView } from "./JsonView.js";
import { formatMs } from "./format.js";

// A step's activity as a timeline: what the agent thought, said and which tools it called.
// While the step runs, the last block grows token by token.

const labelStyle = { fontSize: 11, fontWeight: 600, letterSpacing: 0.4, textTransform: "uppercase" as const, color: theme.textMuted };

function Cursor() {
  return (
    <span
      aria-hidden
      style={{ display: "inline-block", width: 7, height: 14, marginLeft: 2, verticalAlign: "text-bottom", background: theme.primary, animation: "agentlab-blink 1s steps(2) infinite" }}
    />
  );
}

function Thinking({ block, streaming }: { block: ActivityBlock; streaming: boolean }) {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ borderLeft: `2px solid ${theme.border}`, paddingLeft: 10 }}>
      <button type="button" onClick={() => setOpen((v) => !v)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", ...labelStyle }}>
        {open ? "▾" : "▸"} Thinking{streaming ? "…" : ""}
      </button>
      {open ? (
        <div style={{ whiteSpace: "pre-wrap", fontSize: 12.5, lineHeight: 1.5, color: theme.textSecondary, fontStyle: "italic", marginTop: 4 }}>
          {block.text}
          {streaming ? <Cursor /> : null}
        </div>
      ) : null}
    </div>
  );
}

function ToolUse({ block, streaming }: { block: ActivityBlock; streaming: boolean }) {
  const [showOutput, setShowOutput] = useState(false);
  const done = block.output !== undefined;
  const name = block.toolName?.replace(/^mcp__([^_]+)__/, "$1 · ") ?? "tool";
  return (
    <div style={{ border: `1px solid ${theme.border}`, borderRadius: 8, padding: 10, background: theme.surface }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
        <span aria-hidden>🔧</span>
        <strong style={{ fontFamily: theme.fontMono, fontSize: 12.5 }}>{name}</strong>
        <span style={{ marginLeft: "auto", fontSize: 11, color: block.failed ? theme.danger : theme.textMuted }}>
          {block.failed ? "failed" : done ? (block.durationMs !== undefined ? formatMs(block.durationMs) : "done") : streaming ? "writing input…" : "running…"}
        </span>
      </div>
      {block.input !== undefined && typeof block.input !== "string" ? (
        <div style={{ marginTop: 6 }}>
          <JsonView value={block.input} openDepth={1} maxHeight={200} />
        </div>
      ) : block.text ? (
        <pre style={{ margin: "6px 0 0", fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-word", color: theme.textSecondary }}>
          {block.text}
          {streaming ? <Cursor /> : null}
        </pre>
      ) : null}
      {done ? (
        <div style={{ marginTop: 6 }}>
          <button type="button" onClick={() => setShowOutput((v) => !v)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", ...labelStyle }}>
            {showOutput ? "▾" : "▸"} Result
          </button>
          {showOutput ? (
            <div style={{ marginTop: 4 }}>
              <JsonView value={block.output} openDepth={1} maxHeight={260} />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function ActivityView({ blocks, running }: { blocks: ActivityBlock[]; running: boolean }) {
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  // Follow new output while running, unless the user scrolled up to read.
  useEffect(() => {
    const el = scroller.current;
    if (el && running && pinned.current) el.scrollTop = el.scrollHeight;
  });

  if (blocks.length === 0) {
    return <div style={{ fontSize: 12, color: theme.textMuted }}>{running ? "Waiting for the first tokens…" : "No activity recorded for this step."}</div>;
  }

  return (
    <div
      ref={scroller}
      onScroll={(e) => {
        const el = e.currentTarget;
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
      style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 460, overflowY: "auto", paddingRight: 4 }}
    >
      <style>{"@keyframes agentlab-blink { 50% { opacity: 0 } }"}</style>
      {blocks.map((block, index) => {
        const streaming = running && index === blocks.length - 1;
        if (block.kind === "thinking") return <Thinking key={index} block={block} streaming={streaming} />;
        if (block.kind === "tool_use") return <ToolUse key={index} block={block} streaming={streaming} />;
        return (
          <div key={index} style={{ whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.55, color: theme.text }}>
            {block.text}
            {streaming ? <Cursor /> : null}
          </div>
        );
      })}
    </div>
  );
}
