import { Handle, Position, type NodeProps } from "@xyflow/react";
import { colors } from "../theme.js";
import type { AgentFlowNode } from "./graphMapping.js";
import { DANGER, DEMO_COLORS, useEditorContext } from "./EditorContext.js";
import type { DemoNodeFrame } from "./useDemoRun.js";

const handleStyle = { width: 12, height: 12, background: colors.accent, border: `2px solid ${colors.bgBlack}` };

export function AgentNode({ id, data, selected }: NodeProps<AgentFlowNode>) {
  const { agentsById, incoming, invalidNodeIds, demo } = useEditorContext();
  const agent = agentsById.get(data.agentId);
  const waitsFor = incoming[id] ?? 0;
  const demoNode = demo?.nodes[id];

  const borderColor = demoNode
    ? DEMO_COLORS[demoNode.state]
    : invalidNodeIds.has(id)
      ? DANGER
      : selected
        ? colors.accent
        : colors.bgCard;

  return (
    <div
      style={{
        width: 200,
        padding: "10px 12px",
        borderRadius: 10,
        background: colors.bgGrey,
        border: `2px ${demoNode?.state === "waiting" ? "dashed" : "solid"} ${borderColor}`,
        boxShadow:
          demoNode?.state === "running"
            ? `0 0 14px ${DEMO_COLORS.running}88`
            : selected
              ? `0 0 0 3px ${colors.accent}40`
              : "0 2px 6px #0006",
        opacity: demoNode?.state === "idle" ? 0.55 : 1,
        color: colors.secondary,
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
        {demoNode ? <DemoBadge frame={demoNode} /> : null}
      </div>
      <div style={{ opacity: 0.7, marginTop: 2 }}>
        {agent ? `${agent.role} · ${agent.model}` : <span style={{ color: DANGER }}>Unknown agent "{data.agentId}"</span>}
      </div>
      <div style={{ opacity: 0.55, marginTop: 6, fontFamily: "ui-monospace, monospace", fontSize: 11 }}>
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
        color: colors.bgBlack,
        flexShrink: 0,
      }}
    >
      {text}
    </span>
  );
}
