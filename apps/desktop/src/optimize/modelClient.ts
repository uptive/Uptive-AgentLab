import type { JsonRequest, ModelCallUsage, ModelClient } from "@agentlab/optimization";

/** One model call made by an evaluator: what was asked, what came back, and what it used. */
export interface ModelCallRecord {
  evaluatorId?: string;
  model: string;
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  startedAt: string;
  /** The model's JSON answer, when the call succeeded. */
  response?: unknown;
  usage?: ModelCallUsage;
  error?: string;
}

/**
 * Model access for LLM-backed evaluators, on `model`, proxied to the Electron main process through
 * the `window.agentlab.optimization` bridge. `onCall` gets a record of every finished call.
 */
export function createModelClient(model: string, onCall?: (record: ModelCallRecord) => void): ModelClient {
  return {
    async generateJson(request: JsonRequest) {
      const record: ModelCallRecord = {
        evaluatorId: request.evaluatorId,
        model,
        system: request.system,
        prompt: request.prompt,
        schema: request.schema,
        startedAt: new Date().toISOString(),
      };
      try {
        if (typeof window.agentlab === "undefined") throw new Error("Claude is only available in the desktop app (no Electron bridge)");
        const { value, usage } = await window.agentlab.optimization.generateJson({ ...request, model });
        onCall?.({ ...record, response: value, usage });
        return value;
      } catch (error) {
        // Electron prefixes IPC errors with "Error invoking remote method '…': Error: "; keep the useful part.
        const message = (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
        onCall?.({ ...record, error: message });
        throw new Error(message);
      }
    },
  };
}
