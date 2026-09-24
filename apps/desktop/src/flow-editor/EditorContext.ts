import { createContext, useContext } from "react";
import type { AgentDefinition } from "@agentlab/contracts";
import { colors } from "../theme.js";
import type { DemoFrame } from "./useDemoRun.js";

export interface EditorContextValue {
  agentsById: Map<string, AgentDefinition>;
  /** Number of upstream dependencies per node id. */
  incoming: Record<string, number>;
  /** Node ids that have validation errors. */
  invalidNodeIds: Set<string>;
  /** Current frame of the demo-run animation, if one is active. */
  demo?: DemoFrame;
}

export const EditorContext = createContext<EditorContextValue>({
  agentsById: new Map(),
  incoming: {},
  invalidNodeIds: new Set(),
});

export const useEditorContext = () => useContext(EditorContext);

export const DANGER = "#ff6b6b";
export const WARNING = "#f5c451";

export const DEMO_COLORS = {
  idle: "#6a6a6a",
  waiting: WARNING,
  running: WARNING,
  done: colors.accent,
} as const;

// Kept for places that just need an error colour.
export const STATUS_COLORS = { failed: DANGER } as const;
