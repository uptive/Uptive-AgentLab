import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ActivityBlock } from "../liveRuns.js";
import { theme } from "../theme.js";
import { ReadableValue } from "./ReadableValue.js";
import { summarizeToolCall } from "./toolSummary.js";
import { formatMs } from "./format.js";

// A step's activity as a timeline: what the agent thought, said and which tools it called.
// While the step runs, the last block grows token by token.

const labelStyle = { fontSize: 11, fontWeight: 600, letterSpacing: 0.4, textTransform: "uppercase" as const, color: theme.textMuted };

function Cursor() {
  return (
    <>
      <style>{"@keyframes agentlab-blink { 50% { opacity: 0 } }"}</style>
      <span
        aria-hidden
        style={{ display: "inline-block", width: 7, height: 14, marginLeft: 2, verticalAlign: "text-bottom", background: theme.primary, animation: "agentlab-blink 1s steps(2) infinite" }}
      />
    </>
  );
}

function Thinking({ block, streaming }: { block: ActivityBlock; streaming: boolean }) {
  const [open, setOpen] = useState(true);
  // Some models think without sharing their reasoning; say so instead of showing an empty box.
  if (!block.text.trim()) {
    return (
      <div style={{ borderLeft: `2px solid ${theme.border}`, paddingLeft: 10, ...labelStyle }}>
        {streaming ? "Thinking…" : "Thought without sharing its reasoning"}
      </div>
    );
  }
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

function ToolUse({ block, streaming, expanded }: { block: ActivityBlock; streaming: boolean; expanded: boolean }) {
  const [showInput, setShowInput] = useState(expanded);
  const [showOutput, setShowOutput] = useState(expanded);
  const done = block.output !== undefined;
  const input = block.input ?? parseInput(block.text);
  const summary = summarizeToolCall(block.toolName, input);
  const hasInput = input !== undefined && typeof input === "object";
  return (
    <div
      style={{
        border: `1px solid ${block.failed ? theme.danger : theme.border}`,
        borderRadius: 8,
        padding: 10,
        background: block.failed ? theme.errorBg : theme.surface,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
        <span aria-hidden>🔧</span>
        <strong>{summary.title}</strong>
        <span style={{ marginLeft: "auto", fontSize: 11, color: block.failed ? theme.danger : theme.textMuted, fontWeight: block.failed ? 700 : 400 }}>
          {block.failed ? "Failed" : done ? (block.durationMs !== undefined ? formatMs(block.durationMs) : "Done") : streaming ? "Preparing…" : "Running…"}
        </span>
      </div>
      {summary.detail ? (
        <div
          style={{
            marginTop: 4,
            fontSize: 12.5,
            fontFamily: summary.mono ? theme.fontMono : undefined,
            color: theme.textSecondary,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {summary.detail}
        </div>
      ) : null}
      {hasInput ? (
        <Toggle open={showInput} onToggle={() => setShowInput((v) => !v)} label={summary.detail ? "All arguments" : "Arguments"}>
          <ReadableValue value={input} />
        </Toggle>
      ) : null}
      {done ? (
        <Toggle open={showOutput} onToggle={() => setShowOutput((v) => !v)} label={block.failed ? "Error" : "Result"}>
          <ReadableValue value={block.output} />
        </Toggle>
      ) : null}
      {streaming && !hasInput ? <Cursor /> : null}
    </div>
  );
}

function Toggle({ open, onToggle, label, children }: { open: boolean; onToggle: () => void; label: string; children: ReactNode }) {
  return (
    <div style={{ marginTop: 6 }}>
      <button type="button" onClick={onToggle} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", ...labelStyle }}>
        {open ? "▾" : "▸"} {label}
      </button>
      {open ? <div style={{ marginTop: 4, fontSize: 12.5, color: theme.text }}>{children}</div> : null}
    </div>
  );
}

/** Tool input streams in as JSON text; show it once it parses. */
function parseInput(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * One thinking, text or tool block; the last one streams while the step runs. `expanded` opens
 * tool arguments and results up front, for the single-agent view.
 */
export function ActivityBlockView({ block, streaming, expanded = false }: { block: ActivityBlock; streaming: boolean; expanded?: boolean }) {
  if (block.kind === "thinking") return <Thinking block={block} streaming={streaming} />;
  if (block.kind === "tool_use") return <ToolUse block={block} streaming={streaming} expanded={expanded} />;
  return (
    <div style={{ whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.55, color: theme.text }}>
      {block.text}
      {streaming ? <Cursor /> : null}
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
            {blocks.map((block, index) => (
        <ActivityBlockView key={index} block={block} streaming={running && index === blocks.length - 1} />
      ))}
    </div>
  );
}
