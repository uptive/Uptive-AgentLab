import { createContext, useContext } from "react";
import type { AgentDefinition, StepRun, StepStatus } from "@agentlab/contracts";
import { colors } from "../theme.js";

export interface EditorContextValue {
  agentsById: Map<string, AgentDefinition>;
  /** Latest step state per node id for the current/last run. */
  steps: Record<string, StepRun>;
  /** Number of upstream dependencies per node id. */
  incoming: Record<string, number>;
  /** Node ids that have validation errors. */
  invalidNodeIds: Set<string>;
}

export const EditorContext = createContext<EditorContextValue>({
  agentsById: new Map(),
  steps: {},
  incoming: {},
  invalidNodeIds: new Set(),
});

export const useEditorContext = () => useContext(EditorContext);

export const STATUS_COLORS: Record<StepStatus, string> = {
  pending: "#8a8a8a",
  running: "#f5c451",
  completed: colors.accent,
  failed: "#ff6b6b",
};
