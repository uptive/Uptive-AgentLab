import { useEffect, useRef } from "react";
import { theme } from "../theme.js";
import { ActivityBlockView } from "./ActivityView.js";
import type { FeedEntry, FeedTone } from "./feedEntries.js";

const TONE_COLORS: Record<FeedTone, string> = {
  neutral: theme.textMuted,
  running: theme.warning,
  success: theme.statusActive,
  danger: theme.danger,
};

const TONE_ICONS: Record<FeedTone, string> = { neutral: "•", running: "▶", success: "✓", danger: "✗" };

const formatTime = (iso: string | undefined) => (iso ? new Date(iso).toLocaleTimeString() : "now");

interface Props {
  entries: FeedEntry[];
  /** Follow new entries as they arrive (while the run is live). */
  live: boolean;
  /** Name of the agent behind a step; omit to hide the agent column (single-agent feed). */
  agentLabel?: (stepRunId: string) => string;
  onSelectStep?: (stepRunId: string) => void;
}

/** A run's activity as a readable, chronological feed. */
export function RunFeed({ entries, live, agentLabel, onSelectStep }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  // Follow new output while live, unless the user scrolled up to read.
  useEffect(() => {
    const el = scroller.current;
    if (el && live && pinned.current) el.scrollTop = el.scrollHeight;
  });

  if (entries.length === 0) {
    return (
      <div style={{ fontSize: 12, color: theme.textMuted }}>
        {live ? "Waiting for the first activity…" : "No activity was recorded for this run."}
      </div>
    );
  }

  return (
    <div
      ref={scroller}
      onScroll={(e) => {
        const el = e.currentTarget;
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
      style={{ display: "flex", flexDirection: "column", gap: 10, overflowY: "auto", minHeight: 0, flex: 1, paddingRight: 4 }}
    >
      {entries.map((entry) => {
        const agent = agentLabel && entry.stepRunId ? agentLabel(entry.stepRunId) : undefined;
        return (
          <div key={entry.id} style={{ display: "grid", gridTemplateColumns: "64px minmax(0, 1fr)", gap: 8 }}>
            <div style={{ fontSize: 11, color: theme.textMuted, paddingTop: 2, fontVariantNumeric: "tabular-nums" }}>
              {formatTime(entry.at)}
            </div>
            <div style={{ minWidth: 0 }}>
              {agent && entry.kind === "activity" ? (
                <button
                  type="button"
                  onClick={() => entry.stepRunId && onSelectStep?.(entry.stepRunId)}
                  style={{
                    background: "none",
                    border: "none",
                    padding: 0,
                    marginBottom: 3,
                    fontSize: 11,
                    fontWeight: 600,
                    color: theme.primary,
                    cursor: onSelectStep ? "pointer" : "default",
                  }}
                >
                  {agent}
                </button>
              ) : null}
              {entry.kind === "marker" ? (
                <div
                  style={{
                    borderLeft: `3px solid ${TONE_COLORS[entry.tone]}`,
                    background: entry.tone === "danger" ? theme.errorBg : "transparent",
                    borderRadius: 4,
                    padding: "4px 8px",
                    fontSize: 13,
                  }}
                >
                  <span style={{ color: TONE_COLORS[entry.tone], fontWeight: 700 }}>{TONE_ICONS[entry.tone]}</span>{" "}
                  {entry.stepRunId && onSelectStep ? (
                    <button
                      type="button"
                      onClick={() => entry.stepRunId && onSelectStep(entry.stepRunId)}
                      style={{ background: "none", border: "none", padding: 0, font: "inherit", fontWeight: 600, color: theme.text, cursor: "pointer" }}
                    >
                      {entry.title}
                    </button>
                  ) : (
                    <strong>{entry.title}</strong>
                  )}
                  {entry.detail ? (
                    <div style={{ fontSize: 12, marginTop: 2, color: entry.tone === "danger" ? theme.errorText : theme.textMuted, whiteSpace: "pre-wrap" }}>
                      {entry.detail}
                    </div>
                  ) : null}
                </div>
              ) : (
                <ActivityBlockView block={entry.block} streaming={live && entry.streaming} />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
