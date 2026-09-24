import { useState, type CSSProperties, type ReactNode } from "react";
import type { AgentDefinition } from "@agentlab/contracts";
import { colors } from "../theme.js";

// Every JSON file in the repo-level data/agents/ folder is bundled in at build time.
const agentModules = import.meta.glob<AgentDefinition>("../../../../data/agents/*.json", {
  eager: true,
  import: "default",
});

const agents: AgentDefinition[] = Object.values(agentModules).sort((a, b) => a.name.localeCompare(b.name));

export function AgentsView() {
  const [selectedId, setSelectedId] = useState(agents[0]?.id);
  const selected = agents.find((agent) => agent.id === selectedId);

  return (
    <div>
      <h1>Agents</h1>
      <p>Create, configure and test reusable agents.</p>
      {agents.length === 0 ? (
        <p>No agents yet.</p>
      ) : (
        <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, width: 220, flexShrink: 0 }}>
            {agents.map((agent) => (
              <li key={agent.id}>
                <button
                  onClick={() => setSelectedId(agent.id)}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "10px 12px",
                    marginBottom: 8,
                    border: `1px solid ${agent.id === selectedId ? colors.accent : colors.bgGrey}`,
                    borderRadius: 6,
                    background: colors.bgGrey,
                    color: colors.secondary,
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{agent.name}</div>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>{agent.role}</div>
                </button>
              </li>
            ))}
          </ul>
          {selected ? <AgentDetails agent={selected} /> : null}
        </div>
      )}
    </div>
  );
}

function AgentDetails({ agent }: { agent: AgentDefinition }) {
  return (
    <section style={{ flex: 1, minWidth: 0, padding: 16, borderRadius: 8, background: colors.bgGrey }}>
      <h2 style={{ margin: 0 }}>{agent.name}</h2>
      <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
        {agent.id} · {agent.role} · <span style={{ color: colors.accent }}>{agent.model}</span>
      </div>
      {agent.description ? <p>{agent.description}</p> : null}

      <Field label="System instructions">
        <pre style={preStyle}>{agent.systemInstructions}</pre>
      </Field>

      {agent.modelSettings ? (
        <Field label="Model settings">
          <KeyValues values={agent.modelSettings} />
        </Field>
      ) : null}

      <Field label="Tools">
        {agent.tools.length === 0 ? (
          <span style={{ opacity: 0.7 }}>None</span>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {agent.tools.map((tool) => (
              <span
                key={tool.id}
                title={tool.id}
                style={{ padding: "4px 10px", borderRadius: 999, background: colors.bgCard, fontSize: 13 }}
              >
                {tool.name} <span style={{ color: colors.accent, fontSize: 11 }}>{tool.kind}</span>
              </span>
            ))}
          </div>
        )}
      </Field>

      {agent.limits ? (
        <Field label="Limits">
          <KeyValues values={agent.limits} />
        </Field>
      ) : null}

      {agent.inputSchema !== undefined ? (
        <Field label="Input schema">
          <pre style={preStyle}>{JSON.stringify(agent.inputSchema, null, 2)}</pre>
        </Field>
      ) : null}

      {agent.outputSchema !== undefined ? (
        <Field label="Output schema">
          <pre style={preStyle}>{JSON.stringify(agent.outputSchema, null, 2)}</pre>
        </Field>
      ) : null}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", opacity: 0.7, marginBottom: 6 }}>
        {label}
      </div>
      {children}
    </div>
  );
}

function KeyValues({ values }: { values: object }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "4px 16px", fontSize: 14 }}>
      {Object.entries(values).map(([key, value]) => (
        <div key={key} style={{ display: "contents" }}>
          <span style={{ opacity: 0.7 }}>{key}</span>
          <span>{String(value)}</span>
        </div>
      ))}
    </div>
  );
}

const preStyle: CSSProperties = {
  margin: 0,
  padding: 12,
  borderRadius: 6,
  background: colors.bgBlack,
  whiteSpace: "pre-wrap",
  overflowX: "auto",
  fontSize: 13,
};
