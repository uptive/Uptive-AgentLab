/** Shared contract for the preload bridge (`window.agentlab`). Types only. */

export type SaveFlowResult = { canceled: true } | { canceled: false; filePath: string };
export type OpenFlowResult = { canceled: true } | { canceled: false; filePath: string; content: string };

export interface AgentLabApi {
  flows: {
    /** Shows a save dialog (unless `filePath` is given) and writes the JSON. */
    save(json: string, options: { suggestedName: string; filePath?: string }): Promise<SaveFlowResult>;
    /** Shows an open dialog and returns the selected file's contents. */
    open(): Promise<OpenFlowResult>;
  };
}

export const IPC = {
  saveFlow: "flows:save",
  openFlow: "flows:open",
} as const;
