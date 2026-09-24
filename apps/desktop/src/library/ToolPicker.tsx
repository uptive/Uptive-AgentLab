import { useState } from "react";
import type { SkillDefinition, ToolRef } from "@agentlab/contracts";
import { BUILTIN_TOOLS, FUNCTION_TOOLS, builtinToolName } from "@agentlab/agent-runtime";
import type { LibraryMcpServer } from "../../electron/api.js";
import { theme } from "../theme.js";
import { Check, ghostButton, Pill } from "./ui.js";
import { useServerTest } from "./useLibrary.js";

// Checkbox pickers for an agent's tools and skills. Everything unchecked is unavailable to the agent.

const builtinRef = (name: string): ToolRef => ({ id: name, name, kind: "builtin" });

function isKnown(ref: ToolRef, servers: LibraryMcpServer[]): boolean {
  if (builtinToolName(ref)) return true;
  if (ref.kind === "function") return FUNCTION_TOOLS.some((f) => f.id === ref.id);
  return ref.kind === "mcp" && Boolean(ref.serverId) && servers.some((s) => s.id === ref.serverId);
}

export function ToolPicker({
  tools,
  servers,
  onChange,
  onOpenLibrary,
}: {
  tools: ToolRef[];
  servers: LibraryMcpServer[];
  onChange: (tools: ToolRef[]) => void;
  onOpenLibrary?: () => void;
}) {
  const hasBuiltin = (name: string) => tools.some((t) => builtinToolName(t) === name);
  const toggleBuiltin = (name: string, on: boolean) =>
    onChange(on ? [...tools, builtinRef(name)] : tools.filter((t) => builtinToolName(t) !== name));
  const hasFunction = (id: string) => tools.some((t) => t.kind === "function" && t.id === id);
  const toggleFunction = (id: string, label: string, on: boolean) =>
    onChange(on ? [...tools, { id, name: label, kind: "function" }] : tools.filter((t) => !(t.kind === "function" && t.id === id)));
  const unknown = tools.filter((t) => !isKnown(t, servers));

  return (
    <div>
      <Group title="Built-in">
        {BUILTIN_TOOLS.map((tool) => (
          <Check
            key={tool.name}
            checked={hasBuiltin(tool.name)}
            onChange={(on) => toggleBuiltin(tool.name, on)}
            label={tool.label}
            description={tool.description}
            warning={tool.risky}
          />
        ))}
        {FUNCTION_TOOLS.map((tool) => (
          <Check key={tool.id} checked={hasFunction(tool.id)} onChange={(on) => toggleFunction(tool.id, tool.label, on)} label={tool.label} description={tool.description} />
        ))}
      </Group>

      <Group title="Connected services (MCP)">
        {servers.length === 0 ? (
          <p style={{ fontSize: 13, color: theme.textMuted, margin: "4px 0" }}>
            No services connected yet.{" "}
            {onOpenLibrary ? (
              <button type="button" onClick={onOpenLibrary} style={{ ...ghostButton, padding: "2px 10px", fontSize: 12 }}>
                Connect one
              </button>
            ) : null}
          </p>
        ) : (
          servers.map((server) => <ServerTools key={server.id} server={server} tools={tools} onChange={onChange} />)
        )}
      </Group>

      {unknown.length > 0 ? (
        <Group title="Needs attention">
          {unknown.map((ref) => (
            <div key={`${ref.kind}:${ref.id}`} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 13 }}>
              <Pill tone="warn">unknown</Pill>
              <span style={{ flex: 1 }}>
                {ref.name} <span style={{ color: theme.textMuted, fontFamily: theme.fontMono, fontSize: 11 }}>{ref.kind}</span>
              </span>
              <button type="button" style={{ ...ghostButton, padding: "2px 10px", fontSize: 12 }} onClick={() => onChange(tools.filter((t) => t !== ref))}>
                Remove
              </button>
            </div>
          ))}
          <p style={{ fontSize: 12, color: theme.textMuted, margin: "4px 0 0" }}>Runs fail while an agent has tools the app does not know.</p>
        </Group>
      ) : null}
    </div>
  );
}

function ServerTools({ server, tools, onChange }: { server: LibraryMcpServer; tools: ToolRef[]; onChange: (tools: ToolRef[]) => void }) {
  const refs = tools.filter((t) => t.kind === "mcp" && t.serverId === server.id);
  const all = refs.some((t) => !t.toolName);
  const [expanded, setExpanded] = useState(refs.some((t) => t.toolName));
  const { result, testing, retest } = useServerTest(server.id, expanded);
  const others = tools.filter((t) => !(t.kind === "mcp" && t.serverId === server.id));

  const setAll = (on: boolean) => onChange(on ? [...others, { id: server.id, name: server.name, kind: "mcp", serverId: server.id }] : others);
  const setTool = (toolName: string, on: boolean) => {
    const picked = refs.filter((t) => t.toolName && t.toolName !== toolName);
    const next = on ? [...picked, { id: `${server.id}:${toolName}`, name: `${server.name}: ${toolName}`, kind: "mcp" as const, serverId: server.id, toolName }] : picked;
    onChange([...others, ...next]);
  };

  return (
    <div style={{ padding: "4px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <Check checked={all} onChange={setAll} label={server.name} description={all ? "All of this service's tools" : refs.length > 0 ? `${refs.length} selected tools` : undefined} />
        </div>
        {!all ? (
          <button type="button" style={{ ...ghostButton, padding: "2px 10px", fontSize: 12 }} onClick={() => setExpanded((v) => !v)}>
            {expanded ? "Hide tools" : "Pick tools"}
          </button>
        ) : null}
      </div>
      {expanded && !all ? (
        <div style={{ marginLeft: 26, borderLeft: `2px solid ${theme.border}`, paddingLeft: 12 }}>
          {testing && !result ? <p style={{ fontSize: 12, color: theme.textMuted }}>Connecting to {server.name}…</p> : null}
          {result && result.status !== "connected" ? (
            <p style={{ fontSize: 12, color: theme.errorText }}>
              Could not connect: {result.error ?? result.status}{" "}
              <button type="button" style={{ ...ghostButton, padding: "1px 8px", fontSize: 11 }} onClick={() => void retest()}>
                Retry
              </button>
            </p>
          ) : null}
          {result?.tools.map((tool) => (
            <Check
              key={tool.name}
              checked={refs.some((t) => t.toolName === tool.name)}
              onChange={(on) => setTool(tool.name, on)}
              label={<span style={{ fontFamily: theme.fontMono, fontSize: 13 }}>{tool.name}</span>}
              description={tool.description?.split("\n")[0]}
              warning={tool.destructive}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function SkillPicker({
  selected,
  skills,
  onChange,
  onOpenLibrary,
}: {
  selected: string[];
  skills: SkillDefinition[];
  onChange: (skills: string[]) => void;
  onOpenLibrary?: () => void;
}) {
  const missing = selected.filter((name) => !skills.some((s) => s.name === name));
  return (
    <div>
      {skills.length === 0 ? (
        <p style={{ fontSize: 13, color: theme.textMuted, margin: "4px 0" }}>
          No skills yet. A skill is a set of instructions Claude loads when a task needs it, like a brand guide or a checklist.{" "}
          {onOpenLibrary ? (
            <button type="button" onClick={onOpenLibrary} style={{ ...ghostButton, padding: "2px 10px", fontSize: 12 }}>
              Create one
            </button>
          ) : null}
        </p>
      ) : (
        skills.map((skill) => (
          <Check
            key={skill.name}
            checked={selected.includes(skill.name)}
            onChange={(on) => onChange(on ? [...selected, skill.name] : selected.filter((n) => n !== skill.name))}
            label={skill.name}
            description={skill.description}
          />
        ))
      )}
      {missing.map((name) => (
        <div key={name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 13 }}>
          <Pill tone="warn">missing</Pill>
          <span style={{ flex: 1 }}>{name}</span>
          <button type="button" style={{ ...ghostButton, padding: "2px 10px", fontSize: 12 }} onClick={() => onChange(selected.filter((n) => n !== name))}>
            Remove
          </button>
        </div>
      ))}
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: theme.textMuted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 2 }}>{title}</div>
      {children}
    </div>
  );
}
