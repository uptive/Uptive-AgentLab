import type { AgentDefinition } from "@agentlab/contracts";
import { theme } from "../theme.js";

export const AGENT_DRAG_MIME = "application/x-agentlab-agent";

interface Props {
  agents: AgentDefinition[];
  disabled?: boolean;
  onAdd: (agentId: string) => void;
}

export function AgentPalette({ agents, disabled, onAdd }: Props) {
  return (
    <aside style={{ width: 200, padding: 12, borderRight: `1px solid ${theme.border}`, background: theme.surface, overflowY: "auto" }}>
      <h3 style={{ margin: "0 0 4px", fontSize: 13, textTransform: "uppercase", opacity: 0.7 }}>Agents</h3>
      <p style={{ margin: "0 0 12px", fontSize: 11, opacity: 0.6 }}>Drag onto the canvas, or double-click to add.</p>
      {agents.map((agent) => (
        <div
          key={agent.id}
          draggable={!disabled}
          onDragStart={(e) => {
            e.dataTransfer.setData(AGENT_DRAG_MIME, agent.id);
            e.dataTransfer.effectAllowed = "move";
          }}
          onDoubleClick={() => !disabled && onAdd(agent.id)}
          title={agent.description}
          style={{
            padding: "8px 10px",
            marginBottom: 8,
            borderRadius: 8,
            background: theme.pageBg,
            border: `1px solid ${theme.border}`,
            color: theme.text,
            cursor: disabled ? "not-allowed" : "grab",
            opacity: disabled ? 0.5 : 1,
            userSelect: "none",
          }}
        >
          <div style={{ fontWeight: 600, fontSize: 13 }}>{agent.name}</div>
          <div style={{ fontSize: 11, opacity: 0.65 }}>{agent.role}</div>
        </div>
      ))}
    </aside>
  );
}
