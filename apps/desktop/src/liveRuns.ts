import { useSyncExternalStore } from "react";
import type { AgentStreamChunk, TraceEvent } from "@agentlab/contracts";
import { getTelemetryStore } from "@agentlab/observability";

// Real runs execute in the Electron main process with the Claude runtime; their snapshots and trace
// events are pushed here and written into the shared telemetry store, which persists them and
// drives the Runs view.

let connected = false;

/** Subscribes the telemetry store to live runs once. No-op outside the desktop app. */
export function connectLiveRuns(): void {
  if (connected || !canRunForReal()) return;
  connected = true;
  const store = getTelemetryStore();
  window.agentlab.runs.onEvent((event) => store.recordEvent(event));
  window.agentlab.runs.onUpdate((run) => store.saveRun(run));
}

/** True in the desktop app, where runs call Claude; false in a browser preview (mock runtime). */
export function canRunForReal(): boolean {
  return Boolean((window as { agentlab?: { runs?: unknown } }).agentlab?.runs);
}

// ---- Live token stream -------------------------------------------------------------------------

/** One entry in a step's activity: a thinking or text block, or a tool call. */
export interface ActivityBlock {
  kind: "thinking" | "text" | "tool_use";
  /** Streamed text: thinking, answer text, or (for tools) the raw input JSON as it arrives. */
  text: string;
  toolName?: string;
  toolUseId?: string;
  input?: unknown;
  output?: unknown;
  failed?: boolean;
  durationMs?: number;
  /** When the block started: received time for live blocks, event time for recorded ones. */
  at?: string;
}

export interface LiveStep {
  blocks: ActivityBlock[];
  inputTokens?: number;
  outputTokens?: number;
}

const liveSteps = new Map<string, LiveStep>();
// Immutable copy handed to React; replaced after every batch of chunks.
let liveSnapshot: ReadonlyMap<string, LiveStep> = new Map();
const liveListeners = new Set<() => void>();

function applyChunks(chunks: AgentStreamChunk[]) {
  for (const chunk of chunks) {
    const prev = liveSteps.get(chunk.stepRunId) ?? { blocks: [] };
    // Immutable updates so useSyncExternalStore sees a new snapshot.
    let next: LiveStep;
    if (chunk.type === "block") {
      const block: ActivityBlock = { kind: chunk.block, text: "", toolName: chunk.toolName, toolUseId: chunk.toolUseId, at: new Date().toISOString() };
      next = { ...prev, blocks: [...prev.blocks, block] };
    } else if (chunk.type === "delta") {
      const blocks = prev.blocks.length ? [...prev.blocks] : [{ kind: "text" as const, text: "", at: new Date().toISOString() }];
      const last = blocks[blocks.length - 1];
      blocks[blocks.length - 1] = { ...last, text: last.text + chunk.text };
      next = { ...prev, blocks };
    } else {
      next = { ...prev, inputTokens: chunk.inputTokens, outputTokens: chunk.outputTokens };
    }
    liveSteps.set(chunk.stepRunId, next);
  }
  liveSnapshot = new Map(liveSteps);
  for (const listener of liveListeners) listener();
}

let streamConnected = false;
function connectStream() {
  if (streamConnected || !canRunForReal()) return;
  streamConnected = true;
  window.agentlab.runs.onStream(applyChunks);
}

/** The live stream of a step started in this session, or undefined. */
export function useLiveStep(stepRunId: string | undefined): LiveStep | undefined {
  connectStream();
  return useSyncExternalStore(
    (listener) => {
      liveListeners.add(listener);
      return () => liveListeners.delete(listener);
    },
    () => (stepRunId ? liveSteps.get(stepRunId) : undefined),
  );
}

/** The live streams of every step started in this session, keyed by step run id. */
export function useLiveSteps(): ReadonlyMap<string, LiveStep> {
  connectStream();
  return useSyncExternalStore(
    (listener) => {
      liveListeners.add(listener);
      return () => liveListeners.delete(listener);
    },
    () => liveSnapshot,
  );
}

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return text || undefined;
  }
};

// The runtime's own structured-output tool is plumbing; its input is the step output shown elsewhere.
const isVisibleTool = (name?: string) => name !== "StructuredOutput";

interface ModelCallData {
  thinking?: string;
  text?: string;
}
interface ToolCallData {
  toolId: string;
  toolUseId?: string;
  input: unknown;
  output: unknown;
  status?: string;
  durationMs?: number;
}

/**
 * What a step did, in order. Uses the live stream when this session saw the step run (so it
 * updates token by token), otherwise rebuilds it from the step's trace events.
 */
export function buildActivity(stepRunId: string, events: TraceEvent[], live: LiveStep | undefined): ActivityBlock[] {
  const stepEvents = events.filter((e) => e.stepRunId === stepRunId);
  const toolCalls = stepEvents.filter((e) => e.type === "tool_call").map((e) => e.data as ToolCallData);

  if (live && live.blocks.length > 0) {
    const results = new Map(toolCalls.filter((c) => c.toolUseId).map((c) => [c.toolUseId!, c]));
    return live.blocks
      .filter((b) => b.kind !== "tool_use" || isVisibleTool(b.toolName))
      .map((block) => {
        if (block.kind !== "tool_use") return block;
        const result = block.toolUseId ? results.get(block.toolUseId) : undefined;
        return {
          ...block,
          input: result?.input ?? parseJson(block.text),
          output: result?.output,
          failed: result?.status === "failed",
          durationMs: result?.durationMs,
        };
      });
  }

  return stepEvents.flatMap(eventBlocks);
}

/** The activity blocks one recorded trace event stands for; empty for events that aren't activity. */
export function eventBlocks(event: TraceEvent): ActivityBlock[] {
  if (event.type === "model_call") {
    const data = event.data as ModelCallData;
    const blocks: ActivityBlock[] = [];
    if (data.thinking) blocks.push({ kind: "thinking", text: data.thinking, at: event.timestamp });
    if (data.text) blocks.push({ kind: "text", text: data.text, at: event.timestamp });
    return blocks;
  }
  if (event.type === "tool_call") {
    const data = event.data as ToolCallData;
    if (!isVisibleTool(data.toolId)) return [];
    return [
      {
        kind: "tool_use",
        text: "",
        toolName: data.toolId,
        toolUseId: data.toolUseId,
        input: data.input,
        output: data.output,
        failed: data.status === "failed",
        durationMs: data.durationMs,
        at: event.timestamp,
      },
    ];
  }
  return [];
}
