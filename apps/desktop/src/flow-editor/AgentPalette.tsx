import type { AgentSource, SourcedAgent } from "../../electron/api.js";
import { alpha, theme } from "../theme.js";
import { AgentSourceTag } from "./AgentSourceTag.js";
import { WARNING } from "./EditorContext.js";

export const AGENT_DRAG_MIME = "application/x-agentlab-agent";

interface Props {
  agents: SourcedAgent[];
  /** True when editing a cloud flow, where local agents only resolve on this computer. */
  cloud: boolean;
  disabled?: boolean;
  onAdd: (agentId: string) => void;
}

const GROUPS: { source: AgentSource; title: string }[] = [
  { source: "database", title: "Database" },
  { source: "local", title: "Local" },
];

export function AgentPalette({ agents, cloud, disabled, onAdd }: Props) {
  return (
    <aside style={{ width: 200, padding: 12, borderRight: `1px solid ${theme.border}`, background: theme.surface, overflowY: "auto" }}>
      <h3 style={{ margin: "0 0 4px", fontSize: 13, textTransform: "uppercase", opacity: 0.7 }}>Agents</h3>
      <p style={{ margin: "0 0 12px", fontSize: 11, opacity: 0.6 }}>Drag onto the canvas, or double-click to add.</p>
      {GROUPS.map(({ source, title }) => {
        const group = agents.filter((agent) => agent.source === source);
        if (group.length === 0) return null;
        const warn = cloud && source === "local";
        return (
          <section key={source} style={{ marginBottom: 12 }}>
            <h4 style={{ margin: "0 0 6px", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: theme.textMuted }}>
              {title} · {group.length}
            </h4>
            {warn ? (
              <p
                style={{
                  margin: "0 0 8px",
                  padding: "6px 8px",
                  borderRadius: 6,
                  fontSize: 11,
                  lineHeight: 1.4,
                  background: alpha(WARNING, 13),
                  color: theme.text,
                }}
              >
                Only on this computer. Teammates opening this cloud flow will see these as unknown agents.
              </p>
            ) : null}
            {group.map((agent) => (
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
                  border: `1px solid ${warn ? WARNING : theme.border}`,
                  color: theme.text,
                  cursor: disabled ? "not-allowed" : "grab",
                  opacity: disabled ? 0.5 : 1,
                  userSelect: "none",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                  <span style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {agent.name}
                  </span>
                  <AgentSourceTag source={agent.source} warn={warn} />
                </div>
                <div style={{ fontSize: 11, opacity: 0.65 }}>{agent.role}</div>
              </div>
            ))}
          </section>
        );
      })}
    </aside>
  );
}
