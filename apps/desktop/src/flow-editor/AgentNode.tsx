import { Handle, Position, type NodeProps } from "@xyflow/react";
import { alpha, theme } from "../theme.js";
import type { AgentFlowNode } from "./graphMapping.js";
import { AgentSourceTag } from "./AgentSourceTag.js";
import { DANGER, DEMO_COLORS, useEditorContext } from "./EditorContext.js";
import type { DemoNodeFrame } from "./useDemoRun.js";

// Border matches the canvas background (not the node's own fill) so the handle reads as a cutout.
const handleStyle = { width: 12, height: 12, background: theme.primary, border: `2px solid ${theme.canvasBg}` };

export function AgentNode({ id, data, selected }: NodeProps<AgentFlowNode>) {
  const { agentsById, cloud, incoming, invalidNodeIds, demo } = useEditorContext();
  const agent = agentsById.get(data.agentId);
  const waitsFor = incoming[id] ?? 0;
  const demoNode = demo?.nodes[id];

  const borderColor = demoNode
    ? DEMO_COLORS[demoNode.state]
    : invalidNodeIds.has(id)
      ? DANGER
      : selected
        ? theme.primary
        : theme.border;

  return (
    <div
      style={{
        width: 200,
        padding: "10px 12px",
        borderRadius: 10,
        background: theme.surface,
        border: `2px ${demoNode?.state === "waiting" ? "dashed" : "solid"} ${borderColor}`,
        boxShadow:
          demoNode?.state === "running"
            ? `0 0 14px ${alpha(DEMO_COLORS.running, 55)}`
            : selected
              ? `0 0 0 3px ${alpha(theme.primary, 25)}`
              : theme.nodeShadow,
        opacity: demoNode?.state === "idle" ? 0.55 : 1,
        color: theme.text,
        fontSize: 12,
        position: "relative",
        overflow: "hidden",
        transition: "opacity 200ms, border-color 200ms, box-shadow 200ms",
      }}
    >
      <Handle type="target" position={Position.Left} style={handleStyle} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <strong style={{ fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {data.label || agent?.name || data.agentId}
        </strong>
        {demoNode ? <DemoBadge frame={demoNode} /> : agent ? <AgentSourceTag source={agent.source} warn={cloud && agent.source === "local"} /> : null}
      </div>
      <div style={{ opacity: 0.7, marginTop: 2 }}>
        {agent ? `${agent.role} · ${agent.model}` : <span style={{ color: DANGER }}>Unknown agent "{data.agentId}"</span>}
      </div>
      <div style={{ opacity: 0.55, marginTop: 6, fontFamily: theme.fontMono, fontSize: 11 }}>
        {id}
        {waitsFor > 1 ? ` · joins ${waitsFor}` : ""}
      </div>
      {demoNode && demoNode.state !== "idle" ? (
        <div
          style={{
            position: "absolute",
            left: 0,
            bottom: 0,
            height: 3,
            width: `${demoNode.progress * 100}%`,
            background: DEMO_COLORS[demoNode.state],
          }}
        />
      ) : null}
      <Handle type="source" position={Position.Right} style={handleStyle} />
    </div>
  );
}

function DemoBadge({ frame }: { frame: DemoNodeFrame }) {
  const text =
    frame.state === "waiting" ? `waiting ${frame.arrived}/${frame.total}` : frame.state === "done" ? "done" : frame.state === "running" ? "running" : "";
  if (!text) return null;
  return (
    <span
      style={{
        padding: "1px 6px",
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 600,
        textTransform: "uppercase",
        background: DEMO_COLORS[frame.state],
        color: theme.onPrimary,
        flexShrink: 0,
      }}
    >
      {text}
    </span>
  );
}
