import type { FlowDefinition, Run } from "@agentlab/contracts";

export interface FlowEngine {
  execute(flow: FlowDefinition, input: unknown): Promise<Run>;
}

export const engine: FlowEngine = {
  async execute(flow: FlowDefinition, input: unknown): Promise<Run> {
    throw new Error(`Not implemented: execute(${flow.id}), input: ${JSON.stringify(input)}`);
  },
};
