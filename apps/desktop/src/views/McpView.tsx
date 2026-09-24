import { useCallback, useEffect, useState, type CSSProperties } from "react";
import type { McpServerEntry, McpSource } from "../../electron/api.js";
import { alpha, theme } from "../theme.js";

const titleStyle: CSSProperties = { fontFamily: theme.fontTitle, fontWeight: 600, color: theme.title, margin: 0 };

const ghostButton: CSSProperties = {
  padding: "10px 20px",
  borderRadius: 999,
  border: `1px solid ${theme.border}`,
  background: "transparent",
  color: theme.textSecondary,
  fontFamily: theme.fontBody,
  fontWeight: 500,
  fontSize: 15,
  cursor: "pointer",
};

const chip: CSSProperties = {
  display: "inline-block",
  padding: "2px 8px",
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 600,
};

const mono: CSSProperties = { fontFamily: theme.fontMono, fontSize: 12, wordBreak: "break-all" };

function TransportChip({ transport }: { transport: McpServerEntry["transport"] }) {
  const color = transport === "stdio" ? theme.statusDraft : theme.primary;
  return <span style={{ ...chip, background: alpha(color, 15), color }}>{transport}</span>;
}

function ServerCard({ server }: { server: McpServerEntry }) {
  const target = server.url ?? [server.command, ...(server.args ?? [])].filter(Boolean).join(" ");
  const secrets = [
    ...server.envKeys.map((key) => `env ${key}`),
    ...server.headerKeys.map((key) => `header ${key}`),
  ];
  return (
    <div
      style={{
        background: theme.surface,
        border: `1px solid ${theme.border}`,
        borderRadius: 8,
        padding: 14,
        boxShadow: theme.cardShadow,
        opacity: server.disabled ? 0.55 : 1,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <strong style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{server.name}</strong>
        {server.version ? <span style={{ fontSize: 12, color: theme.textMuted }}>v{server.version}</span> : null}
        {server.disabled ? (
          <span style={{ ...chip, background: theme.statusDisabledBg, color: theme.statusDisabledText }}>disabled</span>
        ) : null}
        <TransportChip transport={server.transport} />
      </div>
      <div style={{ ...mono, color: theme.textSecondary, background: theme.codeBg, borderRadius: 6, padding: "6px 8px" }}>
        {target || "—"}
      </div>
      {secrets.length > 0 ? (
        <div style={{ marginTop: 8, fontSize: 12, color: theme.textMuted }}>Uses {secrets.join(", ")}</div>
      ) : null}
    </div>
  );
}

function SourceSection({ source }: { source: McpSource }) {
  const empty =
    source.status === "missing" ? "No config file" : source.status === "invalid" ? `Could not read: ${source.error}` : "No servers";
  return (
    <section style={{ marginBottom: 28 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10 }}>
        <h2 style={{ ...titleStyle, fontSize: 18 }}>{source.label}</h2>
        <span style={{ fontSize: 13, color: theme.textMuted }}>{source.servers.length}</span>
        <span style={{ ...mono, color: theme.textMuted, flex: 1, minWidth: 0 }} title={source.path}>
          {source.path}
        </span>
      </div>
      {source.servers.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: source.status === "invalid" ? theme.danger : theme.textMuted }}>{empty}</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
          {source.servers.map((server) => (
            <ServerCard key={server.name} server={server} />
          ))}
        </div>
      )}
    </section>
  );
}

export function McpView() {
  const [sources, setSources] = useState<McpSource[]>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setSources(await window.agentlab.mcp.list());
      setError(undefined);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const total = sources?.reduce((sum, source) => sum + source.servers.length, 0) ?? 0;
  // Sources with servers first; empty ones are still shown so it's clear where we looked.
  const ordered = [...(sources ?? [])].sort((a, b) => Number(b.servers.length > 0) - Number(a.servers.length > 0));

  return (
    <div style={{ padding: "4px 8px", color: theme.text, fontFamily: theme.fontBody }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h1 style={{ ...titleStyle, fontSize: 26 }}>MCP servers</h1>
          <p style={{ margin: "4px 0 0", color: theme.textSecondary, fontSize: 14 }}>
            {sources ? `${total} ${total === 1 ? "server" : "servers"} configured on this machine` : " "}
          </p>
        </div>
        <button
          style={{ ...ghostButton, opacity: loading ? 0.6 : 1 }}
          onClick={() => void refresh()}
          disabled={loading}
          title="Re-read MCP config files"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error ? (
        <div style={{ background: theme.errorBg, color: theme.errorText, padding: "10px 14px", borderRadius: 8, marginBottom: 16 }}>
          {error}
        </div>
      ) : null}

      <p style={{ margin: "0 0 24px", fontSize: 13, color: theme.textMuted, maxWidth: 720 }}>
        Connectors added on claude.ai (Slack, Notion, Google Drive…) live on your Anthropic account, not in a local file,
        so they are not listed here.
      </p>

      {sources ? ordered.map((source) => <SourceSection key={`${source.kind}:${source.path}`} source={source} />) : null}
      {!sources && !error ? <p style={{ color: theme.textMuted }}>Reading config files…</p> : null}
    </div>
  );
}
