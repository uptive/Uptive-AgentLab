export type RecommendationCategory = "quality" | "token-context" | "model-selection" | "flow-design";

export interface Recommendation {
  id: string;
  category: RecommendationCategory;
  problem: string;
  suggestion: string;
  estimatedImpact?: string;
  targetAgentId?: string;
  targetNodeId?: string;
}

export interface EvaluationResult {
  id: string;
  runId: string;
  flowId: string;
  createdAt: string;
  recommendations: Recommendation[];
}
