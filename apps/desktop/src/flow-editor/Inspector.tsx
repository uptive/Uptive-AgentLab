import type { CSSProperties, ReactNode } from "react";
import type { AgentDefinition, FlowDefinition, Run } from "@agentlab/contracts";
import type { FlowIssue } from "@agentlab/flow-engine";
import { colors } from "../theme.js";
import { StatusBadge } from "./AgentNode.js";
import { STATUS_COLORS } from "./EditorContext.js";
import type { AgentFlowNode, AgentNodeData, FlowMeta } from "./graphMapping.js";

interface Props {
  flow: FlowDefinition;
  meta: FlowMeta;
  onMetaChange: (meta: FlowMeta) => void;
  selectedNode?: AgentFlowNode;
  agents: AgentDefinition[];
  agentsById: Map<string, AgentDefinition>;
  errors: FlowIssue[];
  levels?: string[][];
  run?: Run;
  json: string;
  locked: boolean;
  onUpdateNode: (id: string, patch: Partial<AgentNodeData>) => void;
  onDeleteNode: (id: string) => void;
  onRemoveEdge: (source: string, target: string) => void;
}

export function Inspector(props: Props) {
  return (
    <aside style={{ width: 340, borderLeft: `1px solid ${colors.bgCard}`, overflowY: "auto", padding: 12, fontSize: 13 }}>
      {props.selectedNode ? <NodePanel {...props} node={props.selectedNode} /> : <FlowPanel {...props} />}
    </aside>
  );
}

function FlowPanel({ flow, meta, onMetaChange, errors, levels, json, locked, agentsById }: Props) {
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
          <div style={{ color: colors.accent }}>Flow is valid</div>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, color: STATUS_COLORS.failed }}>
            {errors.map((e, i) => (
              <li key={i}>{e.message}</li>
            ))}
          </ul>
        )}
      </Section>

      {levels ? (
        <Section title="Execution plan">
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

      <Section title="JSON">
        <pre style={preStyle}>{json}</pre>
      </Section>
    </>
  );
}

function NodePanel({ node, flow, agents, agentsById, run, locked, onUpdateNode, onDeleteNode, onRemoveEdge }: Props & { node: AgentFlowNode }) {
  const agent = agentsById.get(node.data.agentId);
  const flowNode = flow.nodes.find((n) => n.id === node.id);
  const dependsOn = flowNode?.dependsOn ?? [];
  const dependents = flow.nodes.filter((n) => n.dependsOn.includes(node.id)).map((n) => n.id);
  const step = run?.steps.find((s) => s.nodeId === node.id);

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
          <select
            style={inputStyle}
            value={node.data.agentId}
            disabled={locked}
            onChange={(e) => onUpdateNode(node.id, { agentId: e.target.value })}
          >
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
              <div style={{ opacity: 0.6, marginBottom: 6 }}>Starts after all of these complete; receives their outputs keyed by node id.</div>
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

      {step ? (
        <Section title="Last run">
          <div style={{ marginBottom: 6 }}>
            <StatusBadge status={step.status} />
            {step.usage ? <span style={{ marginLeft: 8, opacity: 0.7 }}>{step.usage.latencyMs} ms</span> : null}
          </div>
          {step.error ? <div style={{ color: STATUS_COLORS.failed, marginBottom: 6 }}>{step.error}</div> : null}
          {step.input !== undefined ? (
            <Field label="Input">
              <pre style={preStyle}>{JSON.stringify(step.input, null, 2)}</pre>
            </Field>
          ) : null}
          {step.output !== undefined ? (
            <Field label="Output">
              <pre style={preStyle}>{JSON.stringify(step.output, null, 2)}</pre>
            </Field>
          ) : null}
        </Section>
      ) : null}

      {!locked ? (
        <button
          style={{ ...buttonBase, background: "transparent", color: STATUS_COLORS.failed, border: `1px solid ${STATUS_COLORS.failed}` }}
          onClick={() => onDeleteNode(node.id)}
        >
          Delete step
        </button>
      ) : null}
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ marginBottom: 18 }}>
      <h3 style={{ margin: "0 0 8px", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5, opacity: 0.7 }}>{title}</h3>
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

export const buttonBase: CSSProperties = {
  padding: "6px 12px",
  borderRadius: 6,
  border: `1px solid ${colors.bgCard}`,
  background: colors.bgGrey,
  color: colors.secondary,
  cursor: "pointer",
  fontSize: 13,
};

const inputStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "6px 8px",
  borderRadius: 6,
  border: `1px solid ${colors.bgCard}`,
  background: colors.bgBlack,
  color: colors.secondary,
  fontFamily: "inherit",
  fontSize: 13,
};

const preStyle: CSSProperties = {
  margin: 0,
  padding: 8,
  borderRadius: 6,
  background: colors.bgBlack,
  fontSize: 11,
  maxHeight: 260,
  overflow: "auto",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};

const rowStyle: CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "2px 0" };

const linkButton: CSSProperties = {
  background: "none",
  border: "none",
  color: STATUS_COLORS.failed,
  cursor: "pointer",
  fontSize: 12,
};
