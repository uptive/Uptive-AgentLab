/** Shared contract for the preload bridge (`window.agentlab`). Types only. */

export interface FlowSummary {
  id: string;
  name: string;
  description?: string;
  updatedAt: string;
}

export interface AgentLabApi {
  flows: {
    /** Lists all saved flows, most recently updated first. */
    list(): Promise<FlowSummary[]>;
    /** Reads a flow's raw JSON content by id. */
    read(id: string): Promise<string>;
    /** Creates or overwrites a flow's JSON content by id. */
    save(id: string, json: string): Promise<void>;
    /** Deletes a flow by id. */
    delete(id: string): Promise<void>;
  };
}

export const IPC = {
  listFlows: "flows:list",
  readFlow: "flows:read",
  saveFlow: "flows:save",
  deleteFlow: "flows:delete",
} as const;
