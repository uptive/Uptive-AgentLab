import { Handle, Position, type NodeProps } from "@xyflow/react";
import { colors } from "../theme.js";
import type { AgentFlowNode } from "./graphMapping.js";
import { STATUS_COLORS, useEditorContext } from "./EditorContext.js";

const handleStyle = { width: 12, height: 12, background: colors.accent, border: `2px solid ${colors.bgBlack}` };

export function AgentNode({ id, data, selected }: NodeProps<AgentFlowNode>) {
  const { agentsById, steps, incoming, invalidNodeIds } = useEditorContext();
  const agent = agentsById.get(data.agentId);
  const step = steps[id];
  const waitsFor = incoming[id] ?? 0;
  const invalid = invalidNodeIds.has(id);

  const borderColor = step ? STATUS_COLORS[step.status] : invalid ? STATUS_COLORS.failed : selected ? colors.accent : colors.bgCard;

  return (
    <div
      style={{
        width: 200,
        padding: "10px 12px",
        borderRadius: 10,
        background: colors.bgGrey,
        border: `2px solid ${borderColor}`,
        boxShadow: selected ? `0 0 0 3px ${colors.accent}40` : "0 2px 6px #0006",
        color: colors.secondary,
        fontSize: 12,
      }}
    >
      <Handle type="target" position={Position.Left} style={handleStyle} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <strong style={{ fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {data.label || agent?.name || data.agentId}
        </strong>
        {step ? <StatusBadge status={step.status} /> : null}
      </div>
      <div style={{ opacity: 0.7, marginTop: 2 }}>
        {agent ? `${agent.role} · ${agent.model}` : <span style={{ color: STATUS_COLORS.failed }}>Unknown agent "{data.agentId}"</span>}
      </div>
      <div style={{ opacity: 0.55, marginTop: 6, fontFamily: "ui-monospace, monospace", fontSize: 11 }}>
        {id}
        {waitsFor > 1 ? ` · waits for ${waitsFor}` : ""}
      </div>
      <Handle type="source" position={Position.Right} style={handleStyle} />
    </div>
  );
}

export function StatusBadge({ status }: { status: keyof typeof STATUS_COLORS }) {
  return (
    <span
      style={{
        padding: "1px 6px",
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 600,
        textTransform: "uppercase",
        background: STATUS_COLORS[status],
        color: colors.bgBlack,
        flexShrink: 0,
      }}
    >
      {status}
    </span>
  );
}
