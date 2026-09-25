import { useState, type ReactNode } from "react";
import type { AgentDefinition, StepRun } from "@agentlab/contracts";
import { theme } from "../theme.js";
import type { LiveStep } from "../liveRuns.js";
import { ActivityBlockView } from "./ActivityView.js";
import { formatMs, formatUsd, stepLatencyMs } from "./format.js";
import { ReadableValue } from "./ReadableValue.js";
import { RunFeed } from "./RunFeed.js";
import type { FeedEntry } from "./feedEntries.js";
import { StatusBadge } from "./runUi.js";

export function Metric({ label, value, size = 18 }: { label: string; value: string; size?: number }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 12, color: theme.textMuted }}>{label}</div>
      <div style={{ fontSize: size, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>{value}</div>
    </div>
  );
}

function SectionLabel({ children }: { children: string }) {
  return <div style={{ fontSize: 12, color: theme.textMuted, margin: "16px 0 4px" }}>{children}</div>;
}

function Collapsible({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 16 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 12, fontWeight: 600, color: theme.textSecondary }}
      >
        {open ? "▾" : "▸"} {label}
      </button>
      {open ? <div style={{ marginTop: 6, fontSize: 13 }}>{children}</div> : null}
    </div>
  );
}

/** The step's result, front and centre, green when it finished and red when it failed. */
function FinalAnswer({ step }: { step: StepRun }) {
  const color = step.status === "completed" ? theme.statusActive : step.status === "failed" ? theme.danger : theme.textMuted;
  return (
    <div
      style={{
        marginTop: 16,
        border: `1px solid ${step.status === "running" ? theme.border : color}`,
        borderRadius: 8,
        padding: 12,
        background: step.status === "failed" ? theme.errorBg : theme.surface,
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color, marginBottom: 8 }}>
        {step.status === "failed" ? "Failed" : "Final answer"}
      </div>
      {step.status === "running" ? (
        <div style={{ fontSize: 13, color: theme.textMuted }}>The agent is still working. Its answer appears here when it finishes.</div>
      ) : step.status === "failed" ? (
        <div style={{ fontSize: 13, color: theme.errorText }}>{step.error ?? "The step failed."}</div>
      ) : (
        <div style={{ fontSize: 14, lineHeight: 1.6, color: theme.text }}>
          <ReadableValue value={step.output} />
        </div>
      )}
    </div>
  );
}

interface Props {
  step: StepRun;
  agent: AgentDefinition | undefined;
  label: string;
  /** This step's part of the run feed. */
  feed: FeedEntry[];
  live: LiveStep | undefined;
  context: { agentName: string; output: unknown }[];
  now: number;
  onClose: () => void;
}

/** Everything about one agent in a run: its numbers, result and a live feed of what it does. */
export function StepPanel({ step, agent, label, feed, live, context, now, onClose }: Props) {
  const usage = step.usage;
  const running = step.status === "running";
  const latencyMs = usage?.latencyMs ?? stepLatencyMs(step, now);
  // Final usage once the step is done; while it runs, the token counts streamed so far.
  const inputTokens = usage?.inputTokens ?? live?.inputTokens;
  const outputTokens = usage?.outputTokens ?? live?.outputTokens;
  const hasActivity = feed.some((entry) => entry.kind === "activity");

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <strong style={{ fontSize: 16 }}>{label}</strong>
          <div style={{ fontSize: 12, color: theme.textMuted }}>
            {agent?.role ?? step.agentId} · {agent?.model ?? "unknown model"}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <StatusBadge status={step.status} />
          <button
            type="button"
            onClick={onClose}
            aria-label="Back to the run feed"
            style={{ background: "none", border: "none", color: theme.textMuted, cursor: "pointer", fontSize: 14 }}
          >
            ✕
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 16 }}>
        <Metric label={running ? "Latency (so far)" : "Latency"} value={formatMs(latencyMs)} size={16} />
        <Metric label="Cost" value={usage ? formatUsd(usage.estimatedCostUsd) : running ? "When finished" : "-"} size={16} />
        <Metric label={running ? "Input tokens (so far)" : "Input tokens"} value={inputTokens?.toLocaleString() ?? "-"} size={16} />
        <Metric label={running ? "Output tokens (so far)" : "Output tokens"} value={outputTokens?.toLocaleString() ?? "-"} size={16} />
      </div>
      {step.startedAt ? (
        <div style={{ fontSize: 12, color: theme.textMuted, marginTop: 8 }}>
          Started {new Date(step.startedAt).toLocaleTimeString()}
          {step.completedAt ? ` · finished ${new Date(step.completedAt).toLocaleTimeString()}` : ""}
        </div>
      ) : null}

      {step.status === "pending" ? (
        <p style={{ fontSize: 12, color: theme.textMuted, marginTop: 16 }}>
          Waiting for upstream steps to finish. Its activity appears here once this agent starts.
        </p>
      ) : (
        <>
          <FinalAnswer step={step} />
          <SectionLabel>{running ? "Live activity" : "What the agent did"}</SectionLabel>
          {hasActivity || step.toolCalls.length === 0 ? (
            <div style={{ display: "flex", flexDirection: "column", maxHeight: 520 }}>
              <RunFeed entries={feed} live={running} />
            </div>
          ) : (
            // Older runs only kept their tool calls on the step.
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {step.toolCalls.map((call, index) => (
                <ActivityBlockView
                  key={index}
                  streaming={false}
                  block={{
                    kind: "tool_use",
                    text: "",
                    toolName: call.toolId,
                    input: call.input,
                    output: call.output,
                    durationMs: new Date(call.completedAt).getTime() - new Date(call.startedAt).getTime(),
                  }}
                />
              ))}
            </div>
          )}
          <Collapsible label="Input">
            <ReadableValue value={step.input} />
          </Collapsible>
        </>
      )}

      {context.length > 0 ? (
        <Collapsible label={`Context from previous steps (${context.length})`}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {context.map((entry, index) => (
              <div key={index}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>{entry.agentName}</div>
                <ReadableValue value={entry.output} />
              </div>
            ))}
          </div>
        </Collapsible>
      ) : null}

      {agent?.systemInstructions ? (
        <Collapsible label="System instructions">
          <div
            style={{
              background: theme.codeBg,
              border: `1px solid ${theme.border}`,
              borderRadius: 6,
              padding: 10,
              fontSize: 12,
              lineHeight: 1.5,
              whiteSpace: "pre-wrap",
            }}
          >
            {agent.systemInstructions}
          </div>
        </Collapsible>
      ) : null}
    </div>
  );
}
