import { useCallback, useEffect, useRef, useState } from "react";
import type { EvaluationInput, ModelAnalysis, SavedOptimization, SavedOptimizationSummary } from "@agentlab/optimization";

// Absent in a plain browser preview (no Electron preload): then nothing is saved or listed.
const api = () => (window as { agentlab?: Window["agentlab"] }).agentlab?.optimizations;

export const newOptimizationId = () => `opt_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`;

/** Everything needed to reopen an optimization later, and its headline for the list. */
export function toSavedOptimization(state: {
  id: string;
  createdAt: string;
  input: EvaluationInput;
  analyses: ModelAnalysis[];
  analyzedWith: string;
  appliedKeys: Iterable<string>;
  edits: Map<string, unknown>;
}): SavedOptimization {
  const { events: _events, ...input } = state.input; // the evaluators are done with the trace
  const shown = state.analyses.find((a) => a.modelId === state.analyzedWith)?.evaluation;
  const recommendations = shown?.recommendations ?? [];
  const appliedKeys = [...state.appliedKeys];
  return {
    summary: {
      id: state.id,
      createdAt: state.createdAt,
      runId: input.run.id,
      flowName: input.flow.name,
      modelIds: state.analyses.map((a) => a.modelId),
      recommendations: recommendations.length,
      highSeverity: recommendations.filter((r) => r.severity === "high").length,
      savedUsdPerRun: shown ? shown.summary.baseline.costUsd - shown.summary.projected.costUsd : 0,
      applied: appliedKeys.length,
    },
    input,
    analyses: state.analyses,
    analyzedWith: state.analyzedWith,
    appliedKeys,
    edits: [...state.edits],
  };
}

export async function saveOptimization(record: SavedOptimization): Promise<void> {
  await api()?.save(record);
}

export async function loadOptimization(id: string): Promise<SavedOptimization> {
  const bridge = api();
  if (!bridge) throw new Error("Saved optimizations are only available in the desktop app.");
  const record = await bridge.get(id);
  if (!record) throw new Error("This optimization is no longer saved on this computer.");
  return record;
}

/** The most recent saved optimizations, newest first. `refresh` reloads them (e.g. after a save). */
export function useRecentOptimizations() {
  const [data, setData] = useState<SavedOptimizationSummary[]>([]);
  const [unreadable, setUnreadable] = useState<{ file: string; reason: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const request = useRef(0);

  const refresh = useCallback(async () => {
    const id = ++request.current;
    const bridge = api();
    if (!bridge) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const recent = await bridge.listRecent();
      if (id !== request.current) return;
      setData(recent.items);
      setUnreadable(recent.unreadable);
      setError(undefined);
    } catch (e) {
      if (id === request.current) setError(`Couldn't list saved optimizations: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    return () => {
      request.current++; // a late answer after unmount is ignored
    };
  }, [refresh]);

  return { data, unreadable, loading, error, refresh };
}
