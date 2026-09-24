import { createContext, useContext } from "react";
import type { SourcedAgent } from "../../electron/api.js";
import { theme } from "../theme.js";
import type { DemoFrame } from "./useDemoRun.js";

export interface EditorContextValue {
  agentsById: Map<string, SourcedAgent>;
  /** True when the flow is stored in MongoDB, where local agents only resolve on this computer. */
  cloud: boolean;
  /** Number of upstream dependencies per node id. */
  incoming: Record<string, number>;
  /** Node ids that have validation errors. */
  invalidNodeIds: Set<string>;
  /** Current frame of the demo-run animation, if one is active. */
  demo?: DemoFrame;
}

export const EditorContext = createContext<EditorContextValue>({
  agentsById: new Map(),
  cloud: false,
  incoming: {},
  invalidNodeIds: new Set(),
});

export const useEditorContext = () => useContext(EditorContext);

export const DANGER = theme.danger;
export const WARNING = theme.warning;

export const DEMO_COLORS = {
  idle: theme.idle,
  waiting: WARNING,
  running: WARNING,
  // Theme-invariant green (same in light and dark) so "done" reads as success rather than as the
  // primary accent color, which turns blue in light mode.
  done: theme.statusActive,
} as const;

// Kept for places that just need an error colour.
export const STATUS_COLORS = { failed: DANGER } as const;
