import { useSyncExternalStore } from "react";
import type { AgentLabApi, OptimizationSummary } from "../../electron/api.js";

// Renderer side of notifications. The main process decides everything (whether to notify, the
// wording, the digest); the renderer only reports Optimize results and follows "open" requests.
// See docs/notifications.md.

/** The notifications bridge, or undefined in a browser preview without Electron. */
export function notificationsBridge(): AgentLabApi["notifications"] | undefined {
  return (window as { agentlab?: Partial<AgentLabApi> }).agentlab?.notifications;
}

/** Tells the main process an Optimize analysis finished. It notifies only if the window is unfocused. */
export function reportOptimizationFinished(summary: OptimizationSummary): Promise<void> {
  return notificationsBridge()?.optimizationFinished(summary) ?? Promise.resolve();
}

// ---- A run the Runs view should open (from a notification or the tray) -----------------------

/** A new object per request, so asking for the same run (or the list) twice still counts. */
export interface OpenRunRequest {
  /** undefined opens the list of runs. */
  runId?: string;
}

let request: OpenRunRequest | undefined;
const listeners = new Set<() => void>();

function setRequest(next: OpenRunRequest | undefined): void {
  request = next;
  for (const listener of listeners) listener();
}

export const requestOpenRun = (runId?: string) => setRequest({ runId });
export const clearOpenRunRequest = () => setRequest(undefined);

/** What the user asked the Runs view to show; the view handles it and calls clearOpenRunRequest. */
export function useOpenRunRequest(): OpenRunRequest | undefined {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => request,
  );
}
