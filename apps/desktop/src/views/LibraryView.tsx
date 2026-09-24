import { useState, type FormEvent } from "react";
import type { McpServerInput, SkillDefinition } from "@agentlab/contracts";
import type { ImportResult, LibraryMcpServer } from "../../electron/api.js";
import { theme } from "../theme.js";
import { Banner, Card, codeInput, dangerButton, ghostButton, input, Label, Pill, primaryButton, titleStyle } from "../library/ui.js";
import { errorMessage, forgetServerTest, useLibrary, useServerTest } from "../library/useLibrary.js";

// "Tools & skills": connect MCP services and write skills that agents can then be given.

const slug = (text: string, allowUnderscore = false) =>
  text
    .toLowerCase()
    .trim()
    .replace(allowUnderscore ? /[^a-z0-9_-]+/g : /[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

function describeImport(what: string, result: ImportResult): string {
  const lines = [result.imported.length ? `Added ${what}: ${result.imported.join(", ")}` : `No new ${what} added.`];
  for (const s of result.skipped) lines.push(`Skipped ${s.name}: ${s.reason}`);
  return lines.join("\n");
}

export function LibraryView() {
  const { skills, servers, loading, error, refresh } = useLibrary();
  const [notice, setNotice] = useState<{ text: string; tone: "error" | "info" }>();
  const [editingServer, setEditingServer] = useState<LibraryMcpServer | "new">();
  const [editingSkill, setEditingSkill] = useState<SkillDefinition | "new">();

  const act = async (work: () => Promise<string | void>) => {
    try {
      const message = await work();
      if (message) setNotice({ text: message, tone: "info" });
      await refresh();
    } catch (e) {
      setNotice({ text: errorMessage(e), tone: "error" });
    }
  };

  return (
    <div style={{ padding: "4px 8px", fontFamily: theme.fontBody, color: theme.text, maxWidth: 1100 }}>
      <h1 style={{ ...titleStyle, fontSize: 26 }}>Tools & skills</h1>
      <p style={{ margin: "4px 0 24px", color: theme.textSecondary, fontSize: 14 }}>
        Connect services agents can use, and write skills they can follow. Then pick them per agent in the agent editor.
      </p>
      {error ? <Banner>{error}</Banner> : null}
      {notice ? (
        <Banner tone={notice.tone} onDismiss={() => setNotice(undefined)}>
          {notice.text}
        </Banner>
      ) : null}

      <section style={{ marginBottom: 36 }}>
        <SectionHeader
          title="Connected services"
          subtitle="MCP servers give agents tools such as reading Figma files or Jira issues."
          actions={
            <>
              <button type="button" style={ghostButton} onClick={() => void act(async () => describeImport("services", await window.agentlab.mcpServers.importClaudeDesktop()))}>
                Import from Claude Desktop
              </button>
              <button type="button" style={primaryButton} onClick={() => setEditingServer("new")}>
                + Connect service
              </button>
            </>
          }
        />
        {loading && servers.length === 0 ? (
          <p style={{ color: theme.textMuted }}>Loading…</p>
        ) : servers.length === 0 ? (
          <EmptyHint>No services yet. Connect one by URL, or import the ones you already use in Claude Desktop.</EmptyHint>
        ) : (
          <div style={grid}>
            {servers.map((server) => (
              <ServerCard key={server.id} server={server} onEdit={() => setEditingServer(server)} />
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionHeader
          title="Skills"
          subtitle="Instructions Claude loads when a task calls for them: a brand voice, a review checklist, a report template."
          actions={
            <>
              <button type="button" style={ghostButton} onClick={() => void act(async () => describeImport("skills", await window.agentlab.skills.import()))}>
                Import folder
              </button>
              <button type="button" style={primaryButton} onClick={() => setEditingSkill("new")}>
                + New skill
              </button>
            </>
          }
        />
        {loading && skills.length === 0 ? (
          <p style={{ color: theme.textMuted }}>Loading…</p>
        ) : skills.length === 0 ? (
          <EmptyHint>No skills yet. Write one here, or import a skill folder (with a SKILL.md) from a colleague or claude.ai.</EmptyHint>
        ) : (
          <div style={grid}>
            {skills.map((skill) => (
              <Card key={skill.name}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <strong style={{ fontFamily: theme.fontMono, fontSize: 14 }}>{skill.name}</strong>
                  <button type="button" style={{ ...ghostButton, padding: "2px 10px", fontSize: 12 }} onClick={() => setEditingSkill(skill)}>
                    Edit
                  </button>
                </div>
                <p style={{ fontSize: 13, color: theme.textSecondary, margin: "8px 0 0" }}>{skill.description}</p>
              </Card>
            ))}
          </div>
        )}
      </section>

      {editingServer ? (
        <ServerDialog
          server={editingServer === "new" ? undefined : editingServer}
          takenIds={servers.map((s) => s.id)}
          onClose={() => setEditingServer(undefined)}
          onSaved={(message) => {
            setEditingServer(undefined);
            void act(async () => message);
          }}
        />
      ) : null}
      {editingSkill ? (
        <SkillDialog
          skill={editingSkill === "new" ? undefined : editingSkill}
          takenNames={skills.map((s) => s.name)}
          onClose={() => setEditingSkill(undefined)}
          onSaved={(message) => {
            setEditingSkill(undefined);
            void act(async () => message);
          }}
        />
      ) : null}
    </div>
  );
}

const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14 } as const;

function SectionHeader({ title, subtitle, actions }: { title: string; subtitle: string; actions: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, marginBottom: 14, flexWrap: "wrap" }}>
      <div>
        <h2 style={{ ...titleStyle, fontSize: 18 }}>{title}</h2>
        <p style={{ margin: "2px 0 0", color: theme.textMuted, fontSize: 13 }}>{subtitle}</p>
      </div>
      <div style={{ display: "flex", gap: 8 }}>{actions}</div>
    </div>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return <p style={{ color: theme.textMuted, fontSize: 14, padding: "18px 0" }}>{children}</p>;
}

function ServerCard({ server, onEdit }: { server: LibraryMcpServer; onEdit: () => void }) {
  const [tested, setTested] = useState(false);
  const { result, testing, retest } = useServerTest(server.id, tested);
  const needsSecret = Boolean(server.secretRef) && !server.hasSecret;
  const where = server.transport.type === "http" ? server.transport.url : [server.transport.command, ...(server.transport.args ?? [])].join(" ");

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
        <strong style={{ fontSize: 15 }}>{server.name}</strong>
        {result ? (
          <Pill tone={result.status === "connected" ? "ok" : "error"}>{result.status === "connected" ? `${result.tools.length} tools` : result.status}</Pill>
        ) : needsSecret ? (
          <Pill tone="warn">token missing</Pill>
        ) : null}
      </div>
      <code style={{ display: "block", fontSize: 12, color: theme.textMuted, margin: "6px 0 10px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={where}>
        {server.transport.type === "stdio" ? "local: " : ""}
        {where}
      </code>
      {result?.error ? <p style={{ fontSize: 12, color: theme.errorText, margin: "0 0 10px" }}>{result.error}</p> : null}
      {result?.status === "connected" ? (
        <p style={{ fontSize: 12, color: theme.textMuted, margin: "0 0 10px" }}>{result.tools.map((t) => t.name).join(", ")}</p>
      ) : null}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" style={{ ...ghostButton, padding: "4px 12px", fontSize: 12 }} disabled={testing} onClick={() => (tested ? void retest() : setTested(true))}>
          {testing ? "Testing…" : "Test connection"}
        </button>
        <button type="button" style={{ ...ghostButton, padding: "4px 12px", fontSize: 12 }} onClick={onEdit}>
          Edit
        </button>
      </div>
    </Card>
  );
}

function Dialog({ title, onClose, onSubmit, children, footer }: { title: string; onClose: () => void; onSubmit: (e: FormEvent) => void; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: theme.backdrop, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={onSubmit}
        style={{ background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: 12, padding: 24, width: 620, maxWidth: "92vw", maxHeight: "90vh", overflowY: "auto", boxShadow: theme.drawerShadow }}
      >
        <h2 style={{ ...titleStyle, fontSize: 20, marginBottom: 18 }}>{title}</h2>
        {children}
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>{footer}</div>
      </form>
    </div>
  );
}

function ServerDialog({ server, takenIds, onClose, onSaved }: { server?: LibraryMcpServer; takenIds: string[]; onClose: () => void; onSaved: (message: string) => void }) {
  const [name, setName] = useState(server?.name ?? "");
  const [kind, setKind] = useState<"http" | "stdio">(server?.transport.type ?? "http");
  const [url, setUrl] = useState(server?.transport.type === "http" ? server.transport.url : "");
  const [command, setCommand] = useState(
    server?.transport.type === "stdio" ? [server.transport.command, ...(server.transport.args ?? [])].join(" ") : "",
  );
  const [secretEnvVar, setSecretEnvVar] = useState(server?.secretEnvVar ?? "");
  const [token, setToken] = useState("");
  const [removeToken, setRemoveToken] = useState(false);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const id = server?.id ?? slug(name, true);
    if (!server && takenIds.includes(id)) return setError(`A service called "${name}" already exists.`);
    const [cmd, ...args] = command.trim().split(/\s+/);
    const payload: McpServerInput = {
      id,
      name: name.trim(),
      transport: kind === "http" ? { type: "http", url: url.trim() } : { type: "stdio", command: cmd ?? "", args },
      secretRef: server?.secretRef,
      secretEnvVar: kind === "stdio" && secretEnvVar.trim() ? secretEnvVar.trim() : undefined,
    };
    setSaving(true);
    try {
      await window.agentlab.mcpServers.save(payload, removeToken ? null : token || undefined);
      forgetServerTest(id);
      onSaved(`Saved ${payload.name}. Use "Test connection" to check it, then give it to agents in the agent editor.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!server) return;
    try {
      await window.agentlab.mcpServers.delete(server.id);
      forgetServerTest(server.id);
      onSaved(`Removed ${server.name}. Agents that used it will report it as missing.`);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Dialog
      title={server ? `Edit ${server.name}` : "Connect a service"}
      onClose={onClose}
      onSubmit={(e) => void submit(e)}
      footer={
        <>
          {server ? (
            <button type="button" style={dangerButton} onClick={() => void remove()}>
              Remove
            </button>
          ) : null}
          <span style={{ flex: 1 }} />
          <button type="button" style={ghostButton} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" style={{ ...primaryButton, opacity: saving ? 0.6 : 1 }} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      {error ? <Banner onDismiss={() => setError(undefined)}>{error}</Banner> : null}
      <Label text="Name">
        <input style={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Figma" required autoFocus />
      </Label>
      <div style={{ display: "flex", gap: 16, marginBottom: 16, fontSize: 14 }}>
        <label>
          <input type="radio" checked={kind === "http"} onChange={() => setKind("http")} /> Online service (URL)
        </label>
        <label>
          <input type="radio" checked={kind === "stdio"} onChange={() => setKind("stdio")} /> Program on this computer
        </label>
      </div>
      {kind === "http" ? (
        <Label text="Server URL" hint="The MCP address from the service's documentation, usually ending in /mcp.">
          <input style={codeInput} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://mcp.example.com/mcp" required />
        </Label>
      ) : (
        <>
          <Label text="Command" hint="Needs the program (often Node.js or Python) installed on every computer that runs the agent.">
            <input style={codeInput} value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npx -y @modelcontextprotocol/server-filesystem /Users/me/Documents" required />
          </Label>
          <Label text="Environment variable for the token (optional)">
            <input style={codeInput} value={secretEnvVar} onChange={(e) => setSecretEnvVar(e.target.value.toUpperCase())} placeholder="API_TOKEN" />
          </Label>
        </>
      )}
      <Label
        text={server?.hasSecret ? "Access token (a token is saved; leave empty to keep it)" : "Access token (optional)"}
        hint={
          kind === "http"
            ? "Sent as a bearer token. Stored encrypted on this computer only, never in shared files."
            : "Passed to the program in the variable above. Stored encrypted on this computer only."
        }
      >
        <input style={codeInput} type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" disabled={removeToken} />
      </Label>
      {server?.hasSecret ? (
        <label style={{ display: "block", fontSize: 13, marginTop: -8, marginBottom: 16 }}>
          <input type="checkbox" checked={removeToken} onChange={(e) => setRemoveToken(e.target.checked)} /> Remove the saved token
        </label>
      ) : null}
    </Dialog>
  );
}

function SkillDialog({ skill, takenNames, onClose, onSaved }: { skill?: SkillDefinition; takenNames: string[]; onClose: () => void; onSaved: (message: string) => void }) {
  const [name, setName] = useState(skill?.name ?? "");
  const [description, setDescription] = useState(skill?.description ?? "");
  const [instructions, setInstructions] = useState(skill?.instructions ?? "");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const finalName = skill?.name ?? slug(name);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!skill && takenNames.includes(finalName)) return setError(`A skill called "${finalName}" already exists.`);
    setSaving(true);
    try {
      await window.agentlab.skills.save({ name: finalName, description, instructions });
      onSaved(`Saved skill ${finalName}. Give it to agents in the agent editor.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!skill) return;
    try {
      await window.agentlab.skills.delete(skill.name);
      onSaved(`Deleted skill ${skill.name}. Agents that used it will report it as missing.`);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Dialog
      title={skill ? `Edit skill ${skill.name}` : "New skill"}
      onClose={onClose}
      onSubmit={(e) => void submit(e)}
      footer={
        <>
          {skill ? (
            <>
              <button type="button" style={dangerButton} onClick={() => void remove()}>
                Delete
              </button>
              <button type="button" style={ghostButton} onClick={() => void window.agentlab.skills.reveal(skill.name)}>
                Show file
              </button>
            </>
          ) : null}
          <span style={{ flex: 1 }} />
          <button type="button" style={ghostButton} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" style={{ ...primaryButton, opacity: saving ? 0.6 : 1 }} disabled={saving}>
            {saving ? "Saving…" : "Save skill"}
          </button>
        </>
      }
    >
      {error ? <Banner onDismiss={() => setError(undefined)}>{error}</Banner> : null}
      {skill ? null : (
        <Label text="Name" hint={name ? `Saved as ${finalName || "…"}` : "Short, e.g. Brand voice"}>
          <input style={input} value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </Label>
      )}
      <Label
        text="When should Claude use this?"
        hint="Claude only sees this sentence until it decides the skill is relevant, so say exactly when it applies."
      >
        <textarea style={{ ...input, minHeight: 64 }} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Use whenever writing customer-facing text: headlines, buttons, emails." required />
      </Label>
      <Label text="Instructions" hint="Markdown. What Claude should do once it uses the skill: rules, examples, templates.">
        <textarea style={{ ...codeInput, minHeight: 240 }} value={instructions} onChange={(e) => setInstructions(e.target.value)} required />
      </Label>
    </Dialog>
  );
}
