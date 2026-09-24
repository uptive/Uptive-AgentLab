import type { AgentDefinition, AgentResult, AgentRunContext, AgentRuntime } from "@agentlab/contracts";

export { createMemoryAgentStore, validateAgentInput } from "./agentStore.js";

export const runtime: AgentRuntime = {
  async run(agent: AgentDefinition, input: unknown, context: AgentRunContext): Promise<AgentResult> {
    throw new Error(`Not implemented: run(${agent.id}) for run ${context.runId}, input: ${JSON.stringify(input)}`);
  },
};

export * from "./demo.js";
export * from "./tools.js";
