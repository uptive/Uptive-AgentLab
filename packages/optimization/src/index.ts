import type { EvaluationResult, FlowDefinition, Run } from "@agentlab/contracts";

export interface Evaluator {
  evaluate(run: Run, flow: FlowDefinition): Promise<EvaluationResult>;
}

export const qualityEvaluator: Evaluator = {
  async evaluate(run: Run, flow: FlowDefinition): Promise<EvaluationResult> {
    throw new Error(`Not implemented: evaluate(${run.id}) against flow ${flow.id}`);
  },
};
