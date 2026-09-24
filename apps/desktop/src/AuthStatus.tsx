import { useEffect, useState } from "react";
import type { ClaudeAuthStatus } from "../electron/api.js";
import { theme } from "./theme.js";

/** Sidebar line showing what pays for agent runs: a Claude subscription or an API key. */
export function AuthStatus() {
  const [status, setStatus] = useState<ClaudeAuthStatus>();
  const [checking, setChecking] = useState(false);

  const load = (refresh = false) => {
    if (!window.agentlab?.claude) return;
    setChecking(true);
    window.agentlab.claude
      .authStatus(refresh)
      .then(setStatus, (e) => setStatus({ source: "unknown", label: "Claude Code unavailable", error: String(e) }))
      .finally(() => setChecking(false));
  };
  useEffect(() => load(), []);

  if (!window.agentlab?.claude) return null;
  const ok = status && status.source !== "unknown";
  const color = !status ? theme.textMuted : ok ? theme.statusActive : theme.danger;

  return (
    <button
      type="button"
      onClick={() => load(true)}
      title={status?.error ? `${status.error}\n\nClick to check again.` : "What pays for agent runs. Click to check again."}
      style={{
        marginTop: "auto",
        marginBottom: 8,
        padding: "8px 10px",
        border: `1px solid ${theme.border}`,
        borderRadius: 8,
        background: "transparent",
        color: theme.textSecondary,
        fontSize: 11,
        lineHeight: 1.35,
        textAlign: "left",
        cursor: "pointer",
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 6, color: theme.text, fontWeight: 600, marginBottom: 2 }}>
        <span style={{ width: 8, height: 8, borderRadius: 999, background: color, flexShrink: 0 }} />
        {checking && !status ? "Checking Claude…" : status?.source === "api-key" ? "Claude API key" : status?.source === "subscription" ? "Claude subscription" : "Claude not ready"}
      </span>
      <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis" }}>{status?.source === "subscription" ? status.email : status?.label}</span>
    </button>
  );
}
