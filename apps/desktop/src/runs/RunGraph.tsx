import { useMemo } from "react";
import { Background, Controls, ReactFlow, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { AgentDefinition, FlowDefinition, Run, StepRun } from "@agentlab/contracts";
import { theme } from "../theme.js";
import { AgentNode } from "../flow-editor/AgentNode.js";
import { EditorContext, type EditorContextValue } from "../flow-editor/EditorContext.js";
import { FlowEdge } from "../flow-editor/FlowEdge.js";
import { edgeId, flowToGraph, type AgentFlowNode } from "../flow-editor/graphMapping.js";
import type { DemoFrame, DemoNodeFrame } from "../flow-editor/useDemoRun.js";
import { formatMs, formatUsd, stepLatencyMs } from "./format.js";

const nodeTypes = { agent: AgentNode };
const edgeTypes = { flow: FlowEdge };

// Real steps have no known duration, so a running step's bar eases towards full.
const RUNNING_EASE_MS = 2500;

interface Props {
  flow: FlowDefinition;
  run: Run;
  agentsById: Map<string, AgentDefinition>;
  selectedNodeId?: string;
  onSelectNode: (nodeId: string | undefined) => void;
  /** Current time in ms; ticks while the run is live so running steps animate. */
  now: number;
}

/** Read-only flow canvas coloured by the live status of each step in `run`. */
export function RunGraph({ flow, run, agentsById, selectedNodeId, onSelectNode, now }: Props) {
  const graph = useMemo(() => flowToGraph(flow), [flow]);
  const nodes = useMemo(
    () => graph.nodes.map((node) => ({ ...node, selected: node.id === selectedNodeId })),
    [graph, selectedNodeId],
  );

  const ctx = useMemo<EditorContextValue>(() => {
    const incoming: Record<string, number> = {};
    for (const edge of graph.edges) incoming[edge.target] = (incoming[edge.target] ?? 0) + 1;
    return { agentsById, incoming, invalidNodeIds: new Set(), demo: runFrame(flow, run, now) };
  }, [graph, agentsById, flow, run, now]);

  return (
    <EditorContext.Provider value={ctx}>
      <ReactFlow<AgentFlowNode, Edge>
        key={flow.id}
        nodes={nodes}
        edges={graph.edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={(_, node) => onSelectNode(node.id === selectedNodeId ? undefined : node.id)}
        onPaneClick={() => onSelectNode(undefined)}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        colorMode="dark"
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1.2 }}
        proOptions={{ hideAttribution: true }}
        style={{ background: theme.canvasBg, cursor: "default" }}
      >
        <Background color={theme.canvasGrid} gap={20} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </EditorContext.Provider>
  );
}

function runFrame(flow: FlowDefinition, run: Run, now: number): DemoFrame {
  const stepsByNode = new Map(run.steps.map((step) => [step.nodeId, step]));
  const completed = (nodeId: string) => stepsByNode.get(nodeId)?.status === "completed";

  const nodes: Record<string, DemoNodeFrame> = {};
  const edges: Record<string, number | undefined> = {};
  for (const node of flow.nodes) {
    const arrived = node.dependsOn.filter(completed).length;
    nodes[node.id] = nodeFrame(stepsByNode.get(node.id), arrived, node.dependsOn.length, now);
    for (const dep of node.dependsOn) edges[edgeId(dep, node.id)] = completed(dep) ? 1 : undefined;
  }
  return { playing: run.status === "running", nodes, edges };
}

function nodeFrame(step: StepRun | undefined, arrived: number, total: number, now: number): DemoNodeFrame {
  const base = { arrived, total };
  if (!step) return { ...base, state: "idle", progress: 0 };
  const latency = stepLatencyMs(step, now);
  const tokens = step.usage ? `${(step.usage.inputTokens + step.usage.outputTokens).toLocaleString()} tok` : undefined;

  switch (step.status) {
    case "completed":
      return {
        ...base,
        state: "done",
        progress: 1,
        detail: [formatMs(latency), tokens, step.usage ? formatUsd(step.usage.estimatedCostUsd) : undefined]
          .filter(Boolean)
          .join(" · "),
      };
    case "failed":
      return { ...base, state: "failed", progress: 1, detail: step.error };
    case "running":
      return {
        ...base,
        state: "running",
        progress: 1 - Math.exp(-(latency ?? 0) / RUNNING_EASE_MS),
        detail: `running for ${formatMs(latency)}`,
      };
    default:
      return { ...base, state: arrived > 0 ? "waiting" : "idle", progress: 0 };
  }
}
