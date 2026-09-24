import type { PersistedState, RunPersistenceAdapter } from "@agentlab/observability";
import { PERSISTED_STATE_VERSION } from "@agentlab/observability";
import type { AgentLabApi } from "../electron/preload.js";

// The Electron preload always exposes window.agentlab, but in a plain browser
// preview it is absent. The global type declares it as non-optional (see
// global.d.ts) because the other views intentionally fail loudly without it,
// so we widen it to optional here just for the fallback path.
const bridge: AgentLabApi | undefined = (window as { agentlab?: AgentLabApi }).agentlab;

const LOCAL_STORAGE_KEY = "agentlab.telemetry";

function isPersistedState(value: unknown): value is PersistedState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PersistedState>;
  return (
    candidate.version === PERSISTED_STATE_VERSION &&
    Array.isArray(candidate.runs) &&
    Array.isArray(candidate.events)
  );
}

/**
 * Persists telemetry through the Electron IPC bridge when available (electron/preload.ts),
 * falling back to localStorage so the view still works in a plain browser preview.
 */
export const telemetryPersistence: RunPersistenceAdapter = {
  async load(): Promise<PersistedState | null> {
    try {
      if (bridge) {
        const state = await bridge.telemetry.load();
        return isPersistedState(state) ? state : null;
      }
      const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return isPersistedState(parsed) ? parsed : null;
    } catch (err) {
      console.error("Failed to load telemetry:", err);
      return null;
    }
  },
  async save(state: PersistedState): Promise<void> {
    try {
      if (bridge) {
        await bridge.telemetry.save(state);
        return;
      }
      window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      console.error("Failed to save telemetry:", err);
    }
  },
};
