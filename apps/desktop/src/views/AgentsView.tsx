import { useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { MODEL_CATALOG, type AgentDefinition, type AgentInput, type AgentStatus, type ToolRef } from "@agentlab/contracts";
import { theme } from "../theme.js";
import { SkillPicker, ToolPicker } from "../library/ToolPicker.js";
import { useLibrary } from "../library/useLibrary.js";

const MODELS = MODEL_CATALOG.map((m) => m.id);
const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

/** Opens the Tools & skills view (handled by App). */
const openLibrary = () => window.dispatchEvent(new CustomEvent("agentlab:navigate", { detail: "library" }));

interface FormState {
  name: string;
  role: string;
  status: AgentStatus;
  description: string;
  model: string;
  effort: string;
  maxTurns: string;
  systemInstructions: string;
  tools: ToolRef[];
  skills: string[];
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
  effort: "",
  maxTurns: "",
  systemInstructions: "",
  tools: [],
  skills: [],
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
    effort: typeof agent.modelSettings?.effort === "string" ? agent.modelSettings.effort : "",
    maxTurns: agent.modelSettings?.maxTurns?.toString() ?? "",
    systemInstructions: agent.systemInstructions,
    tools: agent.tools,
    skills: agent.skills ?? [],
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
      // Current Claude models reject sampling settings; effort and turns are what the runtime uses.
      temperature: undefined,
      maxTokens: undefined,
      effort: form.effort || undefined,
      maxTurns: toNumber(form.maxTurns),
    },
    systemInstructions: form.systemInstructions,
    tools: form.tools,
    skills: form.skills,
    inputSchema: parseSchema("Input schema", form.inputSchema),
    outputSchema: parseSchema("Output schema", form.outputSchema),
    limits: { maxTokens: toNumber(form.limitMaxTokens), maxCostUsd: toNumber(form.limitMaxCostUsd) },
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
  const library = useLibrary();
  const refreshLibrary = library.refresh;

  // Pick up services and skills added in Tools & skills since the view was opened.
  useEffect(() => {
    if (editing !== undefined) void refreshLibrary();
  }, [editing, refreshLibrary]);

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
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setEditing(undefined);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  function openCreate() {
    setError(undefined);
    setEditing(null);
    setForm(EMPTY_FORM);
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
                  value={form.role}
                  onChange={set("role")}
                  placeholder="e.g. Researches sources and summarizes findings"
                  required
                />
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
                  <label
                    style={{ display: "block", padding: "10px 12px", border: `1px solid ${theme.border}`, borderRadius: 8, background: theme.codeBg }}
                    title="How hard Claude thinks. Lower is faster and cheaper; higher is better for hard problems."
                  >
                    <span style={{ display: "block", fontSize: 12, color: theme.textMuted, marginBottom: 4 }}>Effort</span>
                    <select value={form.effort} onChange={set("effort")} style={{ ...fieldInput, padding: "2px 0", border: "none", background: "transparent", fontSize: 16 }}>
                      <option value="">Model default</option>
                      {EFFORTS.map((e) => (
                        <option key={e} value={e}>
                          {e}
                        </option>
                      ))}
                    </select>
                  </label>
                  <StatInput label="Max turns (model calls)" min={1} step={1} value={form.maxTurns} onChange={set("maxTurns")} />
                </div>
              </Section>

              <Section title="Tools">
                <ToolPicker
                  tools={form.tools}
                  servers={library.servers}
                  onChange={(tools) => setForm((prev) => ({ ...prev, tools }))}
                  onOpenLibrary={openLibrary}
                />
              </Section>

              <Section title="Skills">
                <SkillPicker
                  selected={form.skills}
                  skills={library.skills}
                  onChange={(skills) => setForm((prev) => ({ ...prev, skills }))}
                  onOpenLibrary={openLibrary}
                />
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
