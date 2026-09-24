import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  addEdge,
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type IsValidConnection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Run, StepRun } from "@agentlab/contracts";
import {
  createFlowEngine,
  createMockRuntime,
  dummyAgentRegistry,
  parseFlow,
  serializeFlow,
  topologicalLevels,
  validateFlow,
  wouldCreateCycle,
} from "@agentlab/flow-engine";
import { colors } from "../theme.js";
import { AgentNode } from "./AgentNode.js";
import { AgentPalette, AGENT_DRAG_MIME } from "./AgentPalette.js";
import { EditorContext, STATUS_COLORS, type EditorContextValue } from "./EditorContext.js";
import { readFlow, saveFlow } from "./fileIO.js";
import {
  flowToGraph,
  graphToFlow,
  layoutPositions,
  makeEdge,
  uniqueNodeId,
  type AgentFlowNode,
  type AgentNodeData,
  type FlowMeta,
} from "./graphMapping.js";
import { buttonBase, Inspector } from "./Inspector.js";

const nodeTypes = { agent: AgentNode };
const agents = dummyAgentRegistry.list();
const agentsById = new Map(agents.map((a) => [a.id, a]));
const knownAgentIds = agents.map((a) => a.id);

const emptyMeta = (): FlowMeta => ({ id: "untitled-flow", name: "Untitled flow" });

interface Props {
  flowId: string;
  onBack: () => void;
}

export function FlowEditor(props: Props) {
  return (
    <ReactFlowProvider>
      <FlowEditorInner {...props} />
    </ReactFlowProvider>
  );
}

function FlowEditorInner({ flowId, onBack }: Props) {
  const [meta, setMeta] = useState<FlowMeta>(emptyMeta());
  const [nodes, setNodes, onNodesChange] = useNodesState<AgentFlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [savedJson, setSavedJson] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ kind: "info" | "error"; text: string } | undefined>();
  const [run, setRun] = useState<Run | undefined>();
  const [running, setRunning] = useState(false);
  const [runInput, setRunInput] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const { screenToFlowPosition, fitView } = useReactFlow();

  // ---- Derived state -------------------------------------------------------
  const flow = useMemo(() => graphToFlow(meta, nodes, edges), [meta, nodes, edges]);
  const json = useMemo(() => serializeFlow(flow), [flow]);
  const validation = useMemo(() => validateFlow(flow, { knownAgentIds }), [flow]);
  const levels = useMemo(() => {
    try {
      return topologicalLevels(flow);
    } catch {
      return undefined;
    }
  }, [flow]);
  const selectedNode = nodes.find((n) => n.selected);
  const dirty = json !== savedJson;

  const ctx = useMemo<EditorContextValue>(() => {
    const steps: Record<string, StepRun> = {};
    for (const s of run?.steps ?? []) steps[s.nodeId] = s;
    const incoming: Record<string, number> = {};
    for (const e of edges) incoming[e.target] = (incoming[e.target] ?? 0) + 1;
    const invalidNodeIds = new Set(validation.errors.flatMap((e) => (e.nodeId ? [e.nodeId] : [])));
    return { agentsById, steps, incoming, invalidNodeIds };
  }, [run, edges, validation]);

  // Colour/animate edges by the upstream step's run state.
  const styledEdges = useMemo(
    () =>
      edges.map((e) => {
        const source = ctx.steps[e.source]?.status;
        const target = ctx.steps[e.target]?.status;
        return {
          ...e,
          animated: target === "running",
          style: {
            strokeWidth: 2,
            stroke: source === "completed" ? STATUS_COLORS.completed : source === "failed" ? STATUS_COLORS.failed : "#9a9a9a",
          },
        };
      }),
    [edges, ctx.steps],
  );

  // ---- Graph editing -------------------------------------------------------
  const clearRun = () => setRun(undefined);

  const isValidConnection: IsValidConnection = useCallback(
    (c) => {
      if (!c.source || !c.target || c.source === c.target) return false;
      if (edges.some((e) => e.source === c.source && e.target === c.target)) return false;
      return !wouldCreateCycle(flow, c.source, c.target);
    },
    [edges, flow],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      setEdges((eds) => addEdge(makeEdge(c.source, c.target), eds));
      clearRun();
    },
    [setEdges],
  );

  const addAgentNode = useCallback(
    (agentId: string, position?: { x: number; y: number }) => {
      setNodes((nds) => {
        const id = uniqueNodeId(agentId, nds.map((n) => n.id));
        const pos = position ?? { x: 40 + nds.length * 30, y: 40 + nds.length * 30 };
        const node: AgentFlowNode = { id, type: "agent", position: pos, data: { agentId }, selected: true };
        return [...nds.map((n) => ({ ...n, selected: false })), node];
      });
      clearRun();
    },
    [setNodes],
  );

  const onDragOver = (e: DragEvent) => {
    if (e.dataTransfer.types.includes(AGENT_DRAG_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    }
  };

  const onDrop = (e: DragEvent) => {
    const agentId = e.dataTransfer.getData(AGENT_DRAG_MIME);
    if (!agentId || running) return;
    e.preventDefault();
    const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    addAgentNode(agentId, { x: p.x - 100, y: p.y - 30 }); // centre the node under the cursor
  };

  const updateNode = (id: string, patch: Partial<AgentNodeData>) => {
    setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)));
    clearRun();
  };

  const deleteNode = (id: string) => {
    setNodes((nds) => nds.filter((n) => n.id !== id));
    setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
    clearRun();
  };

  const removeEdge = (source: string, target: string) => {
    setEdges((eds) => eds.filter((e) => !(e.source === source && e.target === target)));
    clearRun();
  };

  const autoLayout = () => {
    const positions = layoutPositions(flow);
    setNodes((nds) => nds.map((n) => ({ ...n, position: positions.get(n.id) ?? n.position })));
    requestAnimationFrame(() => fitView({ padding: 0.2, duration: 300 }));
  };

  // ---- Loading & saving ------------------------------------------------------
  const loadGraph = (graph: ReturnType<typeof flowToGraph>, saved?: string) => {
    abortRef.current?.abort();
    setMeta(graph.meta);
    setNodes(graph.nodes);
    setEdges(graph.edges);
    setSavedJson(saved);
    setRun(undefined);
    requestAnimationFrame(() => fitView({ padding: 0.2 }));
  };

  const confirmDiscard = () => !dirty || window.confirm("Discard unsaved changes?");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setNotice(undefined);
    (async () => {
      try {
        const content = await readFlow(flowId);
        const parsed = parseFlow(content);
        if (cancelled) return;
        const graph = flowToGraph(parsed);
        loadGraph(graph, serializeFlow(graphToFlow(graph.meta, graph.nodes, graph.edges)));
        const issues = validateFlow(parsed, { knownAgentIds });
        if (!issues.valid) {
          setNotice({ kind: "error", text: `Loaded with ${issues.errors.length} problem(s): ${issues.errors[0].message}` });
        }
      } catch (err) {
        if (!cancelled) setNotice({ kind: "error", text: `Could not load flow: ${err instanceof Error ? err.message : String(err)}` });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowId]);

  const handleBack = () => {
    if (!confirmDiscard()) return;
    onBack();
  };

  const save = async () => {
    try {
      await saveFlow(meta.id, json);
      setSavedJson(json);
      setNotice({
        kind: validation.valid ? "info" : "error",
        text: `Saved${validation.valid ? "" : " (flow has validation problems)"}`,
      });
    } catch (err) {
      setNotice({ kind: "error", text: `Could not save flow: ${err instanceof Error ? err.message : String(err)}` });
    }
  };

  // ---- Test run ------------------------------------------------------------
  const startRun = async () => {
    if (!validation.valid) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setNotice(undefined);
    try {
      const engine = createFlowEngine({ runtime: createMockRuntime(), resolveAgent: dummyAgentRegistry.get });
      const result = await engine.execute(
        flow,
        { prompt: runInput },
        {
          signal: controller.signal,
          onRunUpdate: (r) => {
            if (!controller.signal.aborted) setRun(r);
          },
        },
      );
      if (!controller.signal.aborted) setRun(result);
    } catch (err) {
      setNotice({ kind: "error", text: `Run failed: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setRunning(false);
    }
  };

  const stopRun = () => {
    abortRef.current?.abort();
    setNotice({ kind: "info", text: "Stopped scheduling new steps; running steps will finish." });
  };

  // ---- Render --------------------------------------------------------------
  return (
    <EditorContext.Provider value={ctx}>
      <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
        <header style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderBottom: `1px solid ${colors.bgCard}` }}>
          <button style={buttonBase} onClick={handleBack} disabled={running}>
            ← Flows
          </button>
          <strong style={{ fontSize: 15, marginRight: 4 }}>
            {meta.name || "Untitled"}
            {dirty ? <span title="Unsaved changes" style={{ color: colors.accent }}> •</span> : null}
          </strong>
          <span style={{ fontSize: 11, opacity: 0.55, marginRight: "auto", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {meta.id}
          </span>
          <button style={buttonBase} onClick={autoLayout} disabled={running || nodes.length === 0}>Auto-layout</button>
          <button style={buttonBase} onClick={save} disabled={running}>Save</button>
          {running ? (
            <button style={{ ...buttonBase, borderColor: STATUS_COLORS.running, color: STATUS_COLORS.running }} onClick={stopRun}>
              Stop
            </button>
          ) : (
            <button
              style={{
                ...buttonBase,
                background: validation.valid ? colors.accent : colors.bgGrey,
                color: validation.valid ? colors.bgBlack : colors.secondary,
                fontWeight: 600,
                opacity: validation.valid ? 1 : 0.5,
              }}
              onClick={startRun}
              disabled={!validation.valid}
              title={validation.valid ? "Run with mock agents" : "Fix validation problems first"}
            >
              ▶ Demo Run
            </button>
          )}
        </header>

        {notice ? (
          <div
            style={{
              padding: "6px 12px",
              fontSize: 12,
              background: notice.kind === "error" ? `${STATUS_COLORS.failed}22` : `${colors.accent}18`,
              color: notice.kind === "error" ? STATUS_COLORS.failed : colors.secondary,
              display: "flex",
              justifyContent: "space-between",
            }}
          >
            <span>{notice.text}</span>
            <button style={{ background: "none", border: "none", color: "inherit", cursor: "pointer" }} onClick={() => setNotice(undefined)}>
              ✕
            </button>
          </div>
        ) : null}

        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          <AgentPalette agents={agents} disabled={running} onAdd={(id) => addAgentNode(id)} />
          <div style={{ flex: 1, position: "relative" }} onDragOver={onDragOver} onDrop={onDrop}>
            <ReactFlow<AgentFlowNode, Edge>
              nodes={nodes}
              edges={styledEdges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={(changes) => {
                onEdgesChange(changes);
                if (changes.some((c) => c.type === "remove")) clearRun();
              }}
              onNodesDelete={clearRun}
              onConnect={onConnect}
              isValidConnection={isValidConnection}
              nodesConnectable={!running}
              nodesDraggable={!running}
              deleteKeyCode={running ? null : ["Backspace", "Delete"]}
              colorMode="dark"
              fitView
              fitViewOptions={{ padding: 0.2 }}
              proOptions={{ hideAttribution: true }}
              style={{ background: colors.bgBlack }}
            >
              <Background color={colors.bgCard} gap={20} />
              <Controls />
              <MiniMap pannable zoomable style={{ background: colors.bgGrey }} nodeColor={(n) => STATUS_COLORS[ctx.steps[n.id]?.status ?? "pending"]} />
            </ReactFlow>
            {loading ? (
              <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none", opacity: 0.5 }}>
                Loading flow…
              </div>
            ) : nodes.length === 0 ? (
              <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none", opacity: 0.5 }}>
                Drag agents here, then connect the right handle of one step to the left handle of the next.
              </div>
            ) : null}
          </div>
          <Inspector
            flow={flow}
            meta={meta}
            onMetaChange={setMeta}
            selectedNode={selectedNode}
            agents={agents}
            agentsById={agentsById}
            errors={validation.errors}
            levels={levels}
            run={run}
            json={json}
            locked={running}
            onUpdateNode={updateNode}
            onDeleteNode={deleteNode}
            onRemoveEdge={removeEdge}
          />
        </div>
      </div>
    </EditorContext.Provider>
  );
}
