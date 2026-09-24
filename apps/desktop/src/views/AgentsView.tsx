import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import type { AgentDefinition, AgentInput, AgentStatus, ToolRef } from "@agentlab/contracts";
import type { AgentDraft } from "../../electron/api.js";
import { theme } from "../theme.js";

const MODELS = ["claude-opus-5-5", "claude-sonnet-5", "claude-haiku-4-5-20251001", "claude-fable-5-1"];

interface FormState {
  name: string;
  role: string;
  status: AgentStatus;
  description: string;
  model: string;
  temperature: string;
  maxTokens: string;
  systemInstructions: string;
  tools: ToolRef[];
  inputSchema: string;
  outputSchema: string;
  limitMaxTokens: string;
  limitMaxCostUsd: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  role: "",
  status: "draft",
  description: "",
  model: "claude-sonnet-5",
  temperature: "",
  maxTokens: "",
  systemInstructions: "",
  tools: [],
  inputSchema: "",
  outputSchema: "",
  limitMaxTokens: "",
  limitMaxCostUsd: "",
};

const stringifySchema = (schema: unknown) => (schema === undefined ? "" : JSON.stringify(schema, null, 2));

function toForm(agent: AgentDefinition): FormState {
  return {
    name: agent.name,
    role: agent.role,
    status: agent.status ?? "draft",
    description: agent.description ?? "",
    model: agent.model,
    temperature: agent.modelSettings?.temperature?.toString() ?? "",
    maxTokens: agent.modelSettings?.maxTokens?.toString() ?? "",
    systemInstructions: agent.systemInstructions,
    tools: agent.tools,
    inputSchema: stringifySchema(agent.inputSchema),
    outputSchema: stringifySchema(agent.outputSchema),
    limitMaxTokens: agent.limits?.maxTokens?.toString() ?? "",
    limitMaxCostUsd: agent.limits?.maxCostUsd?.toString() ?? "",
  };
}

const toNumber = (value: string) => (value === "" ? undefined : Number(value));

function parseSchema(label: string, text: string): unknown {
  if (text.trim() === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

function toInput(form: FormState, existing?: AgentDefinition): AgentInput {
  return {
    name: form.name.trim(),
    role: form.role.trim(),
    status: form.status,
    description: form.description.trim() || undefined,
    model: form.model.trim(),
    modelSettings: {
      ...existing?.modelSettings,
      temperature: toNumber(form.temperature),
      maxTokens: toNumber(form.maxTokens),
    },
    systemInstructions: form.systemInstructions,
    tools: form.tools,
    inputSchema: parseSchema("Input schema", form.inputSchema),
    outputSchema: parseSchema("Output schema", form.outputSchema),
    limits: { maxTokens: toNumber(form.limitMaxTokens), maxCostUsd: toNumber(form.limitMaxCostUsd) },
  };
}

const toolId = (name: string) => name.toLowerCase().replace(/\s+/g, "-");

/** Overlays a Claude-generated draft on the form; status and limits stay as the user set them. */
function applyDraft(form: FormState, draft: AgentDraft): FormState {
  const tools: ToolRef[] = [];
  for (const tool of draft.tools) {
    const id = toolId(tool.name.trim());
    if (id && !tools.some((t) => t.id === id)) tools.push({ id, name: tool.name.trim(), kind: tool.kind });
  }
  return {
    ...form,
    name: draft.name,
    description: draft.description,
    role: draft.role,
    systemInstructions: draft.systemInstructions,
    model: draft.model,
    temperature: draft.temperature.toString(),
    maxTokens: draft.maxTokens.toString(),
    tools,
    inputSchema: stringifySchema(draft.inputSchema),
    outputSchema: stringifySchema(draft.outputSchema),
  };
}

// Errors thrown in the main process arrive as "Error invoking remote method 'x': Error: <message>".
function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}

const STATUS_STYLES: Record<AgentStatus, CSSProperties> = {
  active: { background: theme.statusActive, color: theme.onStatus },
  draft: { background: theme.statusDraft, color: theme.onStatus },
  disabled: { background: theme.statusDisabledBg, color: theme.statusDisabledText },
};

const titleStyle: CSSProperties = { fontFamily: theme.fontTitle, fontWeight: 600, color: theme.title, margin: 0 };

const pillButton: CSSProperties = {
  padding: "8px 18px",
  borderRadius: 999,
  border: "none",
  background: theme.primary,
  color: theme.onPrimary,
  fontFamily: theme.fontBody,
  fontWeight: 500,
  fontSize: 14,
  cursor: "pointer",
};

const ghostButton: CSSProperties = {
  ...pillButton,
  background: "transparent",
  color: theme.textSecondary,
  border: `1px solid ${theme.border}`,
};

const fieldInput: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "9px 12px",
  borderRadius: 8,
  border: `1px solid ${theme.border}`,
  background: theme.surface,
  color: theme.text,
  fontFamily: theme.fontBody,
  fontSize: 14,
};

const codeInput: CSSProperties = {
  ...fieldInput,
  fontFamily: theme.fontMono,
  fontSize: 13,
  lineHeight: 1.5,
  background: theme.codeBg,
  resize: "vertical",
};

function StatusBadge({ status = "draft" }: { status?: AgentStatus }) {
  return (
    <span
      style={{
        ...STATUS_STYLES[status],
        padding: "2px 10px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        textTransform: "capitalize",
        whiteSpace: "nowrap",
      }}
    >
      {status}
    </span>
  );
}

function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div
      role="alert"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "10px 14px",
        marginBottom: 16,
        borderRadius: 8,
        background: theme.errorBg,
        color: theme.errorText,
        fontSize: 14,
      }}
    >
      <span>{message}</span>
      <button
        onClick={onDismiss}
        style={{ ...ghostButton, padding: "4px 12px", color: theme.errorText, borderColor: "currentColor" }}
      >
        Dismiss
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: "block", marginBottom: 18 }}>
      <span style={{ display: "block", fontSize: 13, fontWeight: 500, color: theme.textSecondary, marginBottom: 6 }}>
        {label}
      </span>
      {children}
    </label>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ marginBottom: 22 }}>
      <h3 style={{ ...titleStyle, fontSize: 14, marginBottom: 10 }}>{title}</h3>
      {children}
    </section>
  );
}

function StatInput({
  label,
  unit,
  ...props
}: { label: string; unit?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label
      style={{
        display: "block",
        padding: "10px 12px",
        border: `1px solid ${theme.border}`,
        borderRadius: 8,
        background: theme.codeBg,
      }}
    >
      <span style={{ display: "block", fontSize: 12, color: theme.textMuted, marginBottom: 4 }}>{label}</span>
      <span style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <input
          type="number"
          placeholder="—"
          {...props}
          style={{
            width: "100%",
            border: "none",
            background: "transparent",
            padding: 0,
            fontFamily: theme.fontTitle,
            fontWeight: 600,
            fontSize: 20,
            color: theme.title,
            outline: "none",
          }}
        />
        {unit ? <span style={{ fontSize: 12, color: theme.textMuted }}>{unit}</span> : null}
      </span>
    </label>
  );
}

const twoColumns: CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 };

function ToolChips({ tools, onChange }: { tools: ToolRef[]; onChange: (tools: ToolRef[]) => void }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ToolRef["kind"]>("function");

  function add() {
    const trimmed = name.trim();
    if (!trimmed || tools.some((tool) => tool.name === trimmed)) return;
    onChange([...tools, { id: toolId(trimmed), name: trimmed, kind }]);
    setName("");
  }

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: tools.length ? 10 : 0 }}>
        {tools.map((tool) => (
          <span
            key={tool.id}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 6px 4px 12px",
              borderRadius: 999,
              border: `1px solid ${theme.border}`,
              background: theme.codeBg,
              fontSize: 13,
              color: theme.text,
            }}
          >
            {tool.name}
            <span style={{ fontFamily: theme.fontMono, fontSize: 11, color: theme.textMuted }}>{tool.kind}</span>
            <button
              type="button"
              aria-label={`Remove ${tool.name}`}
              onClick={() => onChange(tools.filter((t) => t.id !== tool.id))}
              style={{
                border: "none",
                background: "transparent",
                color: theme.textMuted,
                cursor: "pointer",
                fontSize: 16,
                lineHeight: 1,
                padding: "0 4px",
              }}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          style={fieldInput}
          value={name}
          placeholder="Tool name"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <select
          style={{ ...fieldInput, width: 130 }}
          value={kind}
          onChange={(e) => setKind(e.target.value as ToolRef["kind"])}
        >
          <option value="function">function</option>
          <option value="mcp">mcp</option>
        </select>
        <button type="button" style={{ ...ghostButton, flexShrink: 0 }} onClick={add}>
          Add
        </button>
      </div>
    </div>
  );
}

function DescribeBox({
  value,
  onChange,
  onGenerate,
  generating,
}: {
  value: string;
  onChange: (value: string) => void;
  onGenerate: () => void;
  generating: boolean;
}) {
  return (
    <section
      style={{
        marginBottom: 22,
        padding: 14,
        borderRadius: 10,
        border: `1px solid ${theme.border}`,
        background: theme.codeBg,
      }}
    >
      <h3 style={{ ...titleStyle, fontSize: 14, marginBottom: 4 }}>Describe your agent</h3>
      <p style={{ margin: "0 0 10px", fontSize: 13, color: theme.textSecondary }}>
        Explain what it should achieve and Claude will propose the fields below.
      </p>
      <textarea
        aria-label="Agent description for Claude"
        style={{ ...fieldInput, minHeight: 90, resize: "vertical", lineHeight: 1.5 }}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            if (!generating) onGenerate();
          }
        }}
        placeholder="e.g. Reviews pull request diffs for security issues and returns a list of findings with severity and a suggested fix"
        disabled={generating}
      />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10, marginTop: 10 }}>
        {generating ? <span style={{ fontSize: 13, color: theme.textMuted }}>Claude is drafting… this can take a minute</span> : null}
        <button
          type="button"
          style={{ ...pillButton, opacity: generating || !value.trim() ? 0.6 : 1 }}
          onClick={onGenerate}
          disabled={generating || !value.trim()}
        >
          {generating ? "Generating…" : "Generate fields"}
        </button>
      </div>
    </section>
  );
}

function DraftRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <span style={{ display: "block", fontSize: 12, color: theme.textMuted, marginBottom: 3 }}>{label}</span>
      <div style={{ fontSize: 14, color: theme.text, lineHeight: 1.45 }}>{children}</div>
    </div>
  );
}

const draftCode: CSSProperties = {
  margin: 0,
  padding: "8px 10px",
  maxHeight: 180,
  overflow: "auto",
  borderRadius: 6,
  background: theme.surface,
  border: `1px solid ${theme.border}`,
  fontFamily: theme.fontMono,
  fontSize: 12,
  whiteSpace: "pre-wrap",
};

function DraftPreview({ draft, onApply, onDiscard }: { draft: AgentDraft; onApply: () => void; onDiscard: () => void }) {
  return (
    <section
      aria-label="Proposed agent fields"
      style={{
        marginBottom: 22,
        padding: 14,
        borderRadius: 10,
        border: `1px solid ${theme.primary}`,
        background: theme.codeBg,
      }}
    >
      <h3 style={{ ...titleStyle, fontSize: 14, marginBottom: 12 }}>Proposed fields</h3>
      <DraftRow label="Name">{draft.name}</DraftRow>
      <DraftRow label="Description">{draft.description}</DraftRow>
      <DraftRow label="Role">{draft.role}</DraftRow>
      <DraftRow label="Model">
        <span style={{ fontFamily: theme.fontMono, fontSize: 13 }}>{draft.model}</span>
        <span style={{ color: theme.textMuted }}>
          {" "}
          · temperature {draft.temperature} · max tokens {draft.maxTokens}
        </span>
      </DraftRow>
      <DraftRow label="Tools">
        {draft.tools.length ? draft.tools.map((tool) => `${tool.name} (${tool.kind})`).join(", ") : "None"}
      </DraftRow>
      <DraftRow label="System instructions">
        <pre style={draftCode}>{draft.systemInstructions}</pre>
      </DraftRow>
      <details style={{ fontSize: 13, color: theme.textSecondary, marginBottom: 12 }}>
        <summary style={{ cursor: "pointer" }}>Input / output schema</summary>
        <div style={{ ...twoColumns, marginTop: 8 }}>
          <pre style={draftCode}>{stringifySchema(draft.inputSchema)}</pre>
          <pre style={draftCode}>{stringifySchema(draft.outputSchema)}</pre>
        </div>
      </details>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button type="button" style={ghostButton} onClick={onDiscard}>
          Discard
        </button>
        <button type="button" style={pillButton} onClick={onApply}>
          Apply to form
        </button>
      </div>
    </section>
  );
}

function AgentCard({ agent, onOpen }: { agent: AgentDefinition; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        textAlign: "left",
        padding: 18,
        borderRadius: 12,
        border: `1px solid ${theme.border}`,
        background: theme.surface,
        boxShadow: theme.cardShadow,
        cursor: "pointer",
        font: "inherit",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, width: "100%" }}>
        <span style={{ ...titleStyle, fontSize: 16, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {agent.name}
        </span>
        <StatusBadge status={agent.status} />
      </div>
      <span
        style={{
          fontSize: 14,
          color: theme.textSecondary,
          lineHeight: 1.45,
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {agent.role}
      </span>
      <span
        style={{
          marginTop: "auto",
          paddingTop: 12,
          borderTop: `1px solid ${theme.border}`,
          width: "100%",
          fontFamily: theme.fontMono,
          fontSize: 12,
          color: theme.primary,
        }}
      >
        {agent.model}
      </span>
    </button>
  );
}

export function AgentsView() {
  const [agents, setAgents] = useState<AgentDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  // undefined = drawer closed, null = creating, agent = editing
  const [editing, setEditing] = useState<AgentDefinition | null>();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [roles, setRoles] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("");
  const [draft, setDraft] = useState<AgentDraft>();
  const [generating, setGenerating] = useState(false);
  // Bumped whenever the drawer opens or closes, so a draft that finishes afterwards is dropped.
  const draftRequest = useRef(0);

  async function refresh() {
    setLoading(true);
    try {
      setAgents(await window.agentlab.agents.list());
      setError(undefined);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const drawerOpen = editing !== undefined;

  useEffect(() => {
    draftRequest.current++;
    setGenerating(false);
    if (!drawerOpen) return;
    // Suggestions only; the form still works if the role list can't be loaded.
    window.agentlab.roles.list().then(setRoles, () => setRoles([]));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setEditing(undefined);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  function openCreate() {
    setError(undefined);
    setEditing(null);
    setForm(EMPTY_FORM);
    setPrompt("");
    setDraft(undefined);
  }

  async function handleGenerate() {
    const request = ++draftRequest.current;
    setGenerating(true);
    setError(undefined);
    try {
      const result = await window.agentlab.agents.draft({ description: prompt, models: MODELS });
      if (request === draftRequest.current) setDraft(result);
    } catch (e) {
      if (request === draftRequest.current) setError(errorMessage(e));
    } finally {
      if (request === draftRequest.current) setGenerating(false);
    }
  }

  function openEdit(agent: AgentDefinition) {
    setError(undefined);
    setEditing(agent);
    setForm(toForm(agent));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const input = toInput(form, editing ?? undefined);
      if (editing) {
        await window.agentlab.agents.update(editing.id, input);
      } else {
        await window.agentlab.agents.create(input);
      }
      setEditing(undefined);
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(agent: AgentDefinition) {
    try {
      await window.agentlab.agents.delete(agent.id);
      if (editing?.id === agent.id) setEditing(undefined);
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const set = (key: keyof FormState) => (e: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const modelOptions = MODELS.includes(form.model) || !form.model ? MODELS : [form.model, ...MODELS];

  return (
    <div
      style={{
        padding: "4px 8px",
        color: theme.text,
        fontFamily: theme.fontBody,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h1 style={{ ...titleStyle, fontSize: 26 }}>Agents</h1>
          <p style={{ margin: "4px 0 0", color: theme.textSecondary, fontSize: 14 }}>
            {loading && agents.length === 0 ? "\u00a0" : `${agents.length} ${agents.length === 1 ? "agent" : "agents"}`}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            style={{ ...ghostButton, padding: "10px 20px", fontSize: 15, opacity: loading ? 0.6 : 1 }}
            onClick={() => void refresh()}
            disabled={loading}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          <button style={{ ...pillButton, padding: "10px 20px", fontSize: 15 }} onClick={openCreate}>
            + New agent
          </button>
        </div>
      </div>

      {error && !drawerOpen ? <ErrorBanner message={error} onDismiss={() => setError(undefined)} /> : null}

      {loading && agents.length === 0 ? (
        <p style={{ color: theme.textMuted }}>Loading agents…</p>
      ) : agents.length === 0 ? (
        <p style={{ color: theme.textMuted }}>No agents yet.</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(258px, 1fr))", gap: 14 }}>
          {agents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} onOpen={() => openEdit(agent)} />
          ))}
        </div>
      )}

      {drawerOpen ? (
        <>
          <div
            onClick={() => setEditing(undefined)}
            style={{ position: "fixed", inset: 0, background: theme.backdrop, zIndex: 10 }}
          />
          <form
            onSubmit={handleSubmit}
            role="dialog"
            aria-modal="true"
            aria-label={editing ? editing.name : "New agent"}
            style={{
              position: "fixed",
              top: 0,
              right: 0,
              height: "100vh",
              width: 560,
              maxWidth: "100vw",
              display: "flex",
              flexDirection: "column",
              background: theme.surface,
              boxShadow: theme.drawerShadow,
              zIndex: 11,
            }}
          >
            <header
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: "20px 24px",
                borderBottom: `1px solid ${theme.border}`,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <h2 style={{ ...titleStyle, fontSize: 20, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {editing ? editing.name : "New agent"}
                </h2>
                {editing ? (
                  <span style={{ fontFamily: theme.fontMono, fontSize: 12, color: theme.textMuted }}>{editing.id}</span>
                ) : null}
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setEditing(undefined)}
                style={{ border: "none", background: "transparent", fontSize: 24, color: theme.textMuted, cursor: "pointer" }}
              >
                ×
              </button>
            </header>

            <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
              {error ? <ErrorBanner message={error} onDismiss={() => setError(undefined)} /> : null}

              {editing === null ? (
                draft ? (
                  <DraftPreview
                    draft={draft}
                    onApply={() => {
                      setForm((prev) => applyDraft(prev, draft));
                      setDraft(undefined);
                    }}
                    onDiscard={() => setDraft(undefined)}
                  />
                ) : (
                  <DescribeBox value={prompt} onChange={setPrompt} onGenerate={() => void handleGenerate()} generating={generating} />
                )
              ) : null}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 160px", gap: 12 }}>
                <Field label="Name *">
                  <input style={fieldInput} value={form.name} onChange={set("name")} required />
                </Field>
                <Field label="Status">
                  <select style={fieldInput} value={form.status} onChange={set("status")}>
                    <option value="draft">Draft</option>
                    <option value="active">Active</option>
                    <option value="disabled">Disabled</option>
                  </select>
                </Field>
              </div>
              <Field label="Description">
                <input style={fieldInput} value={form.description} onChange={set("description")} />
              </Field>
              <Field label="Role *">
                <input
                  style={fieldInput}
                  list="agent-roles"
                  value={form.role}
                  onChange={set("role")}
                  placeholder="Pick or type a role, e.g. reviewer"
                  required
                />
                <datalist id="agent-roles">
                  {roles.map((role) => (
                    <option key={role} value={role} />
                  ))}
                </datalist>
              </Field>
              <Field label="System instructions *">
                <textarea
                  style={{ ...codeInput, minHeight: 160 }}
                  value={form.systemInstructions}
                  onChange={set("systemInstructions")}
                  required
                />
              </Field>
              <Field label="Model *">
                <select style={{ ...fieldInput, fontFamily: theme.fontMono, fontSize: 13 }} value={form.model} onChange={set("model")} required>
                  {modelOptions.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              </Field>

              <Section title="Model settings">
                <div style={twoColumns}>
                  <StatInput label="Temperature" min={0} max={1} step={0.1} value={form.temperature} onChange={set("temperature")} />
                  <StatInput label="Max tokens" min={1} step={1} value={form.maxTokens} onChange={set("maxTokens")} />
                </div>
              </Section>

              <Section title="Allowed tools">
                <ToolChips tools={form.tools} onChange={(tools) => setForm((prev) => ({ ...prev, tools }))} />
              </Section>

              <Section title="Input / output schema">
                <div style={twoColumns}>
                  <textarea
                    aria-label="Input schema"
                    style={{ ...codeInput, minHeight: 140 }}
                    value={form.inputSchema}
                    onChange={set("inputSchema")}
                    placeholder={'{\n  "type": "object"\n}'}
                    spellCheck={false}
                  />
                  <textarea
                    aria-label="Output schema"
                    style={{ ...codeInput, minHeight: 140 }}
                    value={form.outputSchema}
                    onChange={set("outputSchema")}
                    placeholder={'{\n  "type": "object"\n}'}
                    spellCheck={false}
                  />
                </div>
              </Section>

              <Section title="Limits">
                <div style={twoColumns}>
                  <StatInput label="Max tokens per run" min={1} step={1} value={form.limitMaxTokens} onChange={set("limitMaxTokens")} />
                  <StatInput label="Max cost" unit="USD" min={0} step={0.01} value={form.limitMaxCostUsd} onChange={set("limitMaxCostUsd")} />
                </div>
              </Section>
            </div>

            <footer
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "16px 24px",
                borderTop: `1px solid ${theme.border}`,
              }}
            >
              {editing ? (
                <button
                  type="button"
                  onClick={() => handleDelete(editing)}
                  style={{ ...ghostButton, color: theme.errorText, borderColor: theme.errorBg }}
                >
                  Delete
                </button>
              ) : null}
              <span style={{ flex: 1 }} />
              <button type="button" style={ghostButton} onClick={() => setEditing(undefined)}>
                Cancel
              </button>
              <button type="submit" style={{ ...pillButton, opacity: saving ? 0.7 : 1 }} disabled={saving}>
                {saving ? "Saving…" : editing ? "Save changes" : "Create agent"}
              </button>
            </footer>
          </form>
        </>
      ) : null}
    </div>
  );
}
