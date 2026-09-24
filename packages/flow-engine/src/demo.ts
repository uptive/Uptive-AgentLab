import type { FlowDefinition, FlowNode } from "@agentlab/contracts";

/**
 * Demo flow used by the workshop's "Review PR #42" scenario. Group 2 owns the
 * real flow registry; this is a placeholder so other groups can build against it.
 */
export const demoFlow: FlowDefinition = {
  id: "code-review-flow",
  name: "Code Review Flow",
  description: "Planner -> [Code Reviewer || Security Reviewer] -> Final Validator",
  nodes: [
    { id: "n1", agentId: "planner", dependsOn: [] },
    { id: "n2", agentId: "code-reviewer", dependsOn: ["n1"] },
    { id: "n3", agentId: "security-reviewer", dependsOn: ["n1"] },
    { id: "n4", agentId: "final-validator", dependsOn: ["n2", "n3"] },
  ],
};

const demoFlows: FlowDefinition[] = [demoFlow];

export function findFlow(id: string, flows: FlowDefinition[] = demoFlows): FlowDefinition | undefined {
  return flows.find((flow) => flow.id === id);
}

/**
 * Groups flow nodes into topological layers. Nodes that share a layer have no
 * dependency between them, so a scheduler can execute them in parallel and a
 * visualiser can render them on the same row.
 */
export function computeFlowLayers(flow: FlowDefinition): FlowNode[][] {
  const layers: FlowNode[][] = [];
  const placed = new Set<string>();
  const remaining = new Map(flow.nodes.map((node) => [node.id, node]));

  while (remaining.size > 0) {
    const layer: FlowNode[] = [];
    for (const node of remaining.values()) {
      if (node.dependsOn.every((dep) => placed.has(dep))) {
        layer.push(node);
      }
    }
    if (layer.length === 0) {
      // Circular or missing dependency; return what we have plus the leftovers.
      layers.push(Array.from(remaining.values()));
      break;
    }
    layers.push(layer);
    for (const node of layer) {
      placed.add(node.id);
      remaining.delete(node.id);
    }
  }

  return layers;
}
