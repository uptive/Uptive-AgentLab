export interface FlowNode {
  id: string;
  agentId: string;
  dependsOn: string[];
  inputMapping?: Record<string, string>;
}

export interface FlowDefinition {
  id: string;
  name: string;
  description?: string;
  nodes: FlowNode[];
}
