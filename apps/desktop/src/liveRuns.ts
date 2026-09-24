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
