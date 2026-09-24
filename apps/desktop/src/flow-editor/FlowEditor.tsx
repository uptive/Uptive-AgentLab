import { useCallback, useEffect, useMemo, useState, type DragEvent } from "react";
import {
  addEdge,
  Background,
  ControlButton,
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
import type { FlowDefinition } from "@agentlab/contracts";
import { dummyAgentRegistry, serializeFlow, topologicalLevels, validateFlow, wouldCreateCycle } from "@agentlab/flow-engine";
import { alpha, theme, useThemeMode } from "../theme.js";
import { AgentNode } from "./AgentNode.js";
import { AgentPalette, AGENT_DRAG_MIME } from "./AgentPalette.js";
import { bridge, errorMessage } from "./bridge.js";
import { DANGER, DEMO_COLORS, EditorContext, type EditorContextValue } from "./EditorContext.js";
import { FlowEdge } from "./FlowEdge.js";
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
import { Inspector } from "./Inspector.js";
import { buttonBase, primaryButton } from "./styles.js";
import { useDemoRun } from "./useDemoRun.js";

const nodeTypes = { agent: AgentNode };
const edgeTypes = { flow: FlowEdge };
const agents = dummyAgentRegistry.list();
const agentsById = new Map(agents.map((a) => [a.id, a]));
const knownAgentIds = agents.map((a) => a.id);

interface Props {
  filePath: string;
  initialFlow: FlowDefinition;
  /** Called to go back to the project view. */
  onClose: () => void;
}

export function FlowEditor(props: Props) {
  return (
    <ReactFlowProvider>
      <FlowEditorInner {...props} />
    </ReactFlowProvider>
  );
}

function FlowEditorInner({ filePath, initialFlow, onClose }: Props) {
  const initial = useMemo(() => flowToGraph(initialFlow), [initialFlow]);
  const [meta, setMeta] = useState<FlowMeta>(initial.meta);
  const [nodes, setNodes, onNodesChange] = useNodesState<AgentFlowNode>(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initial.edges);
  // Normalised JSON of what's on disk, so opening a file doesn't mark it dirty.
  const [savedJson, setSavedJson] = useState(() => serializeFlow(graphToFlow(initial.meta, initial.nodes, initial.edges)));
  const [notice, setNotice] = useState<{ kind: "info" | "error"; text: string }>();
  const [saving, setSaving] = useState(false);
  const demo = useDemoRun();
  const playing = demo.frame?.playing ?? false;
  const { screenToFlowPosition, fitView } = useReactFlow();
  const colorMode = useThemeMode();

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
    const incoming: Record<string, number> = {};
    for (const e of edges) incoming[e.target] = (incoming[e.target] ?? 0) + 1;
    const invalidNodeIds = new Set(validation.errors.flatMap((e) => (e.nodeId ? [e.nodeId] : [])));
    return { agentsById, incoming, invalidNodeIds, demo: demo.frame };
  }, [edges, validation, demo.frame]);

  // Any structural edit invalidates a finished demo run's picture.
  const stopDemo = demo.stop;
  const edited = useCallback(() => stopDemo(), [stopDemo]);

  // ---- Graph editing -------------------------------------------------------
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
      edited();
    },
    [setEdges, edited],
  );

  const addAgentNode = useCallback(
    (agentId: string, position?: { x: number; y: number }) => {
      setNodes((nds) => {
        const id = uniqueNodeId(agentId, nds.map((n) => n.id));
        const pos = position ?? { x: 40 + nds.length * 30, y: 40 + nds.length * 30 };
        const node: AgentFlowNode = { id, type: "agent", position: pos, data: { agentId }, selected: true };
        return [...nds.map((n) => ({ ...n, selected: false })), node];
      });
      edited();
    },
    [setNodes, edited],
  );

  const onDragOver = (e: DragEvent) => {
    if (e.dataTransfer.types.includes(AGENT_DRAG_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    }
  };

  const onDrop = (e: DragEvent) => {
    const agentId = e.dataTransfer.getData(AGENT_DRAG_MIME);
    if (!agentId || playing) return;
    e.preventDefault();
    const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    addAgentNode(agentId, { x: p.x - 100, y: p.y - 30 }); // centre the node under the cursor
  };

  const updateNode = (id: string, patch: Partial<AgentNodeData>) => {
    setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)));
    edited();
  };

  const deleteNode = (id: string) => {
    setNodes((nds) => nds.filter((n) => n.id !== id));
    setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
    edited();
  };

  const removeEdge = (source: string, target: string) => {
    setEdges((eds) => eds.filter((e) => !(e.source === source && e.target === target)));
    edited();
  };

  const autoLayout = () => {
    const positions = layoutPositions(flow);
    setNodes((nds) => nds.map((n) => ({ ...n, position: positions.get(n.id) ?? n.position })));
    requestAnimationFrame(() => fitView({ padding: 0.2, duration: 300 }));
  };

  // ---- Save / close --------------------------------------------------------
  const save = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      await bridge().flows.write(filePath, json);
      setSavedJson(json);
      setNotice(validation.valid ? undefined : { kind: "error", text: "Saved, but the flow has validation problems." });
    } catch (err) {
      setNotice({ kind: "error", text: `Could not save: ${errorMessage(err)}` });
    } finally {
      setSaving(false);
    }
  }, [filePath, json, saving, validation.valid]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  const close = () => {
    if (dirty && !window.confirm("You have unsaved changes. Leave without saving?")) return;
    onClose();
  };

  // ---- Demo run ------------------------------------------------------------
  const canDemo = validation.valid;
  const toggleDemo = () => (playing ? demo.stop() : demo.start(flow));

  // ---- Render --------------------------------------------------------------
  return (
    <EditorContext.Provider value={ctx}>
      <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
        <header style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderBottom: `1px solid ${theme.border}`, background: theme.surface }}>
          <button style={buttonBase} onClick={close} title="Back to projects">
            ← Projects
          </button>
          <strong style={{ fontSize: 15, marginLeft: 4, color: theme.title }}>
            {meta.name || "Untitled"}
            {dirty ? <span title="Unsaved changes" style={{ color: theme.primary }}> •</span> : null}
          </strong>
          <span
            style={{ fontSize: 11, color: theme.textMuted, marginRight: "auto", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            title={filePath}
          >
            {filePath}
          </span>
          <button style={{ ...buttonBase, opacity: dirty ? 1 : 0.6 }} onClick={() => void save()} disabled={saving} title="Save (⌘S)">
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            style={
              playing
                ? { ...buttonBase, borderColor: DEMO_COLORS.running, color: DEMO_COLORS.running }
                : { ...primaryButton, opacity: canDemo ? 1 : 0.5, cursor: canDemo ? "pointer" : "not-allowed" }
            }
            onClick={toggleDemo}
            disabled={!playing && !canDemo}
            title={canDemo ? "Visualise how work flows through the steps (no agents are run)" : "Fix validation problems first"}
          >
            {playing ? "■ Stop" : "▶ Demo run"}
          </button>
        </header>

        {notice ? (
          <div
            style={{
              padding: "6px 12px",
              fontSize: 12,
              background: notice.kind === "error" ? alpha(DANGER, 13) : alpha(theme.primary, 10),
              color: notice.kind === "error" ? DANGER : theme.text,
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
          <AgentPalette agents={agents} disabled={playing} onAdd={(id) => addAgentNode(id)} />
          <div style={{ flex: 1, position: "relative" }} onDragOver={onDragOver} onDrop={onDrop}>
            <ReactFlow<AgentFlowNode, Edge>
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={(changes) => {
                onEdgesChange(changes);
                if (changes.some((c) => c.type === "remove")) edited();
              }}
              onNodesDelete={edited}
              onConnect={onConnect}
              isValidConnection={isValidConnection}
              nodesConnectable={!playing}
              nodesDraggable={!playing}
              deleteKeyCode={playing ? null : ["Backspace", "Delete"]}
              colorMode={colorMode}
              fitView
              fitViewOptions={{ padding: 0.2, maxZoom: 1.2 }}
              proOptions={{ hideAttribution: true }}
              style={{ background: theme.canvasBg }}
            >
              <Background color={theme.canvasGrid} gap={20} />
              <Controls>
                <ControlButton onClick={autoLayout} disabled={playing || nodes.length === 0} title="Auto-layout" aria-label="Auto-layout">
                  <AutoLayoutIcon />
                </ControlButton>
              </Controls>
              <MiniMap
                pannable
                zoomable
                style={{ background: theme.surface }}
                nodeColor={(n) => (demo.frame ? DEMO_COLORS[demo.frame.nodes[n.id]?.state ?? "idle"] : theme.border)}
              />
            </ReactFlow>
            {nodes.length === 0 ? (
              <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none", color: theme.textMuted, textAlign: "center" }}>
                Drag agents from the left onto the canvas.
                <br />
                Connect the right handle of a step to the left handle of the next one.
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
            json={json}
            locked={playing}
            onUpdateNode={updateNode}
            onDeleteNode={deleteNode}
            onRemoveEdge={removeEdge}
          />
        </div>
      </div>
    </EditorContext.Provider>
  );
}

/** Small "columns" glyph matching React Flow's control icon style. */
function AutoLayoutIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden>
      <rect x="1" y="6" width="4" height="4" rx="1" />
      <rect x="11" y="1" width="4" height="4" rx="1" />
      <rect x="11" y="11" width="4" height="4" rx="1" />
      <path d="M5 8h3M8 3v10M8 3h3M8 13h3" stroke="currentColor" strokeWidth="1.2" fill="none" />
    </svg>
  );
}
