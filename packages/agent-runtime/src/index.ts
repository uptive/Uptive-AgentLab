import type { AgentDefinition, AgentResult, AgentRunContext, AgentRuntime } from "@agentlab/contracts";

export const runtime: AgentRuntime = {
  async run(agent: AgentDefinition, input: unknown, context: AgentRunContext): Promise<AgentResult> {
    throw new Error(`Not implemented: run(${agent.id}) for run ${context.runId}, input: ${JSON.stringify(input)}`);
  },
};
