import type { PersistedState, RunPersistenceAdapter } from "@agentlab/observability";
import { PERSISTED_STATE_VERSION } from "@agentlab/observability";

declare global {
  interface Window {
    agentlab?: {
      telemetry: {
        load(): Promise<PersistedState | null>;
        save(state: PersistedState): Promise<void>;
      };
    };
  }
}

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
      if (window.agentlab) {
        const state = await window.agentlab.telemetry.load();
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
      if (window.agentlab) {
        await window.agentlab.telemetry.save(state);
        return;
      }
      window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      console.error("Failed to save telemetry:", err);
    }
  },
};
