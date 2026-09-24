import { useState, type CSSProperties, type ReactNode } from "react";
import type { AgentDefinition, FlowDefinition } from "@agentlab/contracts";
import type { FlowIssue } from "@agentlab/flow-engine";
import { theme } from "../theme.js";
import { DANGER } from "./EditorContext.js";
import type { AgentFlowNode, AgentNodeData, FlowMeta } from "./graphMapping.js";
import { buttonBase, inputStyle, preStyle } from "./styles.js";

interface Props {
  flow: FlowDefinition;
  meta: FlowMeta;
  onMetaChange: (meta: FlowMeta) => void;
  selectedNode?: AgentFlowNode;
  agents: AgentDefinition[];
  agentsById: Map<string, AgentDefinition>;
  errors: FlowIssue[];
  levels?: string[][];
  json: string;
  locked: boolean;
  onUpdateNode: (id: string, patch: Partial<AgentNodeData>) => void;
  onDeleteNode: (id: string) => void;
  onRemoveEdge: (source: string, target: string) => void;
}

export function Inspector(props: Props) {
  return (
    <aside style={{ width: 320, borderLeft: `1px solid ${theme.border}`, background: theme.surface, color: theme.text, overflowY: "auto", padding: 12, fontSize: 13 }}>
      {props.selectedNode ? <NodePanel {...props} node={props.selectedNode} /> : <FlowPanel {...props} />}
    </aside>
  );
}

function FlowPanel({ flow, meta, onMetaChange, errors, levels, json, locked, agentsById }: Props) {
  const [showJson, setShowJson] = useState(false);
  const label = (id: string) => {
    const node = flow.nodes.find((n) => n.id === id);
    return node?.label || agentsById.get(node?.agentId ?? "")?.name || id;
  };

  return (
    <>
      <Section title="Flow">
        <Field label="Name">
          <input style={inputStyle} value={meta.name} disabled={locked} onChange={(e) => onMetaChange({ ...meta, name: e.target.value })} />
        </Field>
        <Field label="Id">
          <input style={inputStyle} value={meta.id} disabled={locked} onChange={(e) => onMetaChange({ ...meta, id: e.target.value })} />
        </Field>
        <Field label="Description">
          <textarea
            style={{ ...inputStyle, minHeight: 48, resize: "vertical" }}
            value={meta.description ?? ""}
            disabled={locked}
            onChange={(e) => onMetaChange({ ...meta, description: e.target.value || undefined })}
          />
        </Field>
      </Section>

      <Section title={errors.length ? `Problems (${errors.length})` : "Validation"}>
        {errors.length === 0 ? (
          <div style={{ color: theme.statusActive }}>Flow is valid</div>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, color: DANGER }}>
            {errors.map((e, i) => (
              <li key={i}>{e.message}</li>
            ))}
          </ul>
        )}
      </Section>

      {levels && levels.length > 0 ? (
        <Section title="Execution order">
          <ol style={{ margin: 0, paddingLeft: 18 }}>
            {levels.map((level, i) => (
              <li key={i} style={{ marginBottom: 4 }}>
                {level.map(label).join("  ∥  ")}
                {level.length > 1 ? <span style={{ opacity: 0.6 }}> (parallel)</span> : null}
              </li>
            ))}
          </ol>
        </Section>
      ) : null}

      <section style={{ marginBottom: 18 }}>
        <button
          onClick={() => setShowJson((v) => !v)}
          aria-expanded={showJson}
          style={{ ...sectionTitle, background: "none", border: "none", padding: 0, color: theme.title, cursor: "pointer", display: "flex", gap: 6 }}
        >
          <span style={{ display: "inline-block", width: 10, transform: showJson ? "rotate(90deg)" : "none", transition: "transform 120ms" }}>▸</span>
          JSON
        </button>
        {showJson ? <pre style={preStyle}>{json}</pre> : null}
      </section>
    </>
  );
}

function NodePanel({ node, flow, agents, agentsById, locked, onUpdateNode, onDeleteNode, onRemoveEdge }: Props & { node: AgentFlowNode }) {
  const agent = agentsById.get(node.data.agentId);
  const dependsOn = flow.nodes.find((n) => n.id === node.id)?.dependsOn ?? [];
  const dependents = flow.nodes.filter((n) => n.dependsOn.includes(node.id)).map((n) => n.id);

  return (
    <>
      <Section title="Step">
        <Field label="Node id">
          <code>{node.id}</code>
        </Field>
        <Field label="Label">
          <input
            style={inputStyle}
            placeholder={agent?.name}
            value={node.data.label ?? ""}
            disabled={locked}
            onChange={(e) => onUpdateNode(node.id, { label: e.target.value || undefined })}
          />
        </Field>
        <Field label="Agent">
          <select style={inputStyle} value={node.data.agentId} disabled={locked} onChange={(e) => onUpdateNode(node.id, { agentId: e.target.value })}>
            {!agent ? <option value={node.data.agentId}>Unknown: {node.data.agentId}</option> : null}
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
        {agent ? (
          <div style={{ opacity: 0.75, fontSize: 12 }}>
            <div>{agent.description}</div>
            <div style={{ marginTop: 4 }}>
              Model: <code>{agent.model}</code>
            </div>
          </div>
        ) : null}
      </Section>

      <Section title={`Waits for (${dependsOn.length})`}>
        {dependsOn.length === 0 ? (
          <div style={{ opacity: 0.6 }}>Starts immediately with the flow input.</div>
        ) : (
          <>
            {dependsOn.length > 1 ? (
              <div style={{ opacity: 0.6, marginBottom: 6 }}>Starts after all of these complete and receives all of their outputs.</div>
            ) : null}
            {dependsOn.map((dep) => (
              <div key={dep} style={rowStyle}>
                <code>{dep}</code>
                {!locked ? (
                  <button style={linkButton} onClick={() => onRemoveEdge(dep, node.id)}>
                    remove
                  </button>
                ) : null}
              </div>
            ))}
          </>
        )}
      </Section>

      <Section title={`Hands off to (${dependents.length})`}>
        {dependents.length === 0 ? (
          <div style={{ opacity: 0.6 }}>Final step.</div>
        ) : (
          dependents.map((d) => (
            <div key={d} style={rowStyle}>
              <code>{d}</code>
            </div>
          ))
        )}
      </Section>

      {!locked ? (
        <button style={{ ...buttonBase, background: "transparent", color: DANGER, border: `1px solid ${DANGER}` }} onClick={() => onDeleteNode(node.id)}>
          Delete step
        </button>
      ) : null}
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ marginBottom: 18 }}>
      <h3 style={{ ...sectionTitle, margin: "0 0 8px" }}>{title}</h3>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: "block", marginBottom: 8 }}>
      <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 3 }}>{label}</div>
      {children}
    </label>
  );
}

const sectionTitle: CSSProperties = { fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, opacity: 0.7 };
const rowStyle: CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "2px 0" };
const linkButton: CSSProperties = { background: "none", border: "none", color: DANGER, cursor: "pointer", fontSize: 12 };
