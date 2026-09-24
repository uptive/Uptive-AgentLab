import { useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import type { AgentDefinition, AgentInput, AgentStatus, ToolRef } from "@agentlab/contracts";
import type { AgentSource, SourcedAgent } from "../../electron/api.js";
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
    onChange([...tools, { id: trimmed.toLowerCase().replace(/\s+/g, "-"), name: trimmed, kind }]);
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

const SOURCE_LABELS: Record<AgentSource, string> = { local: "Local", database: "Database" };

const SOURCE_HINTS: Record<AgentSource, string> = {
  local: "JSON file in data/local-agents/, only on this computer",
  database: "MongoDB, shared with the team",
};

function SourcePicker({
  value,
  onChange,
  databaseError,
}: {
  value: AgentSource;
  onChange: (source: AgentSource) => void;
  databaseError?: string;
}) {
  return (
    <div role="radiogroup" aria-label="Save to" style={{ marginBottom: 18 }}>
      <span style={{ display: "block", fontSize: 13, fontWeight: 500, color: theme.textSecondary, marginBottom: 6 }}>
        Save to
      </span>
      <div style={twoColumns}>
        {(["local", "database"] as const).map((source) => {
          const selected = value === source;
          const unavailable = source === "database" && !!databaseError;
          return (
            <button
              key={source}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={unavailable}
              onClick={() => onChange(source)}
              style={{
                textAlign: "left",
                padding: "10px 12px",
                borderRadius: 8,
                border: `${selected ? 2 : 1}px solid ${selected ? theme.primary : theme.border}`,
                background: theme.surface,
                color: theme.text,
                font: "inherit",
                cursor: unavailable ? "not-allowed" : "pointer",
                opacity: unavailable ? 0.5 : 1,
              }}
            >
              <span style={{ display: "block", fontWeight: 600, fontSize: 14 }}>{SOURCE_LABELS[source]}</span>
              <span style={{ display: "block", fontSize: 12, color: theme.textMuted, marginTop: 2 }}>
                {unavailable ? "MongoDB is unreachable" : SOURCE_HINTS[source]}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const inlineCode: CSSProperties = {
  fontFamily: theme.fontMono,
  fontSize: 12,
  padding: "1px 5px",
  borderRadius: 4,
  background: theme.surface,
  border: `1px solid ${theme.border}`,
};

function LocalAgentsHelp() {
  return (
    <div
      style={{
        margin: "0 0 14px",
        padding: "12px 16px",
        borderRadius: 8,
        border: `1px solid ${theme.border}`,
        background: theme.codeBg,
        fontSize: 13,
        lineHeight: 1.55,
        color: theme.textSecondary,
      }}
    >
      <p style={{ margin: "0 0 6px" }}>
        Local agents are private: they are saved as JSON files on this computer only, the folder is gitignored, and
        they are never sent to MongoDB. Add one in either of two ways:
      </p>
      <ol style={{ margin: 0, paddingLeft: 20 }}>
        <li>
          Click <strong>+ New agent</strong> and choose <strong>Local</strong> under <em>Save to</em>.
        </li>
        <li>
          Drop a <code style={inlineCode}>.json</code> file into <code style={inlineCode}>data/local-agents/</code>{" "}
          (or the folder in <code style={inlineCode}>LOCAL_AGENTS_DIR</code>) and press <strong>Refresh</strong>. It
          needs <code style={inlineCode}>name</code>, <code style={inlineCode}>role</code>,{" "}
          <code style={inlineCode}>model</code> and <code style={inlineCode}>systemInstructions</code>; without an{" "}
          <code style={inlineCode}>id</code>, the file name is used. Invalid files are skipped with a warning in the
          console.
        </li>
      </ol>
    </div>
  );
}

function AgentSection({
  title,
  hint,
  agents,
  notice,
  onOpen,
}: {
  title: string;
  hint: string;
  agents: SourcedAgent[];
  notice?: ReactNode;
  onOpen: (agent: SourcedAgent) => void;
}) {
  return (
    <section style={{ marginBottom: 28 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 12 }}>
        <h2 style={{ ...titleStyle, fontSize: 18 }}>{title}</h2>
        <span style={{ fontSize: 13, color: theme.textMuted }}>
          {agents.length} · {hint}
        </span>
      </div>
      {notice}
      {agents.length === 0 ? (
        notice ? null : <p style={{ color: theme.textMuted, margin: 0 }}>No agents yet.</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(258px, 1fr))", gap: 14 }}>
          {agents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} onOpen={() => onOpen(agent)} />
          ))}
        </div>
      )}
    </section>
  );
}

export function AgentsView() {
  const [agents, setAgents] = useState<SourcedAgent[]>([]);
  const [databaseError, setDatabaseError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  // undefined = drawer closed, null = creating, agent = editing
  const [editing, setEditing] = useState<SourcedAgent | null>();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saveTo, setSaveTo] = useState<AgentSource>("database");
  const [saving, setSaving] = useState(false);

  async function refresh(reloadLocal = false) {
    setLoading(true);
    try {
      const listing = await window.agentlab.agents.load({ reloadLocal });
      setAgents(listing.agents);
      setDatabaseError(listing.databaseError ? errorMessage(listing.databaseError) : undefined);
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
    setSaveTo(databaseError ? "local" : "database");
  }

  function openEdit(agent: SourcedAgent) {
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
        await window.agentlab.agents.create(input, saveTo);
      }
      setEditing(undefined);
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(agent: SourcedAgent) {
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

  const localAgents = agents.filter((agent) => agent.source === "local");
  const databaseAgents = agents.filter((agent) => agent.source === "database");

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
            onClick={() => void refresh(true)}
            disabled={loading}
            title="Reload agents from MongoDB and re-read data/local-agents/"
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
      ) : (
        <>
          <AgentSection
            title="Local"
            hint="JSON files in data/local-agents/, not committed"
            agents={localAgents}
            onOpen={openEdit}
            notice={<LocalAgentsHelp />}
          />
          <AgentSection
            title="Database"
            hint="shared through MongoDB"
            agents={databaseAgents}
            onOpen={openEdit}
            notice={
              databaseError ? (
                <p style={{ margin: "0 0 12px", fontSize: 14, color: theme.errorText }}>
                  Could not reach MongoDB: {databaseError}
                </p>
              ) : undefined
            }
          />
        </>
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
                  <span style={{ fontFamily: theme.fontMono, fontSize: 12, color: theme.textMuted }}>
                    {SOURCE_LABELS[editing.source]} · {editing.id}
                  </span>
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

              {editing ? null : (
                <SourcePicker value={saveTo} onChange={setSaveTo} databaseError={databaseError} />
              )}

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
