import type { ReactNode } from "react";
import { theme } from "../theme.js";

// Shared message strip for errors and notices (see CODE_INSTRUCTIONS.md, Frontend).

type Tone = "error" | "info";

export function Banner({ tone = "info", children, onDismiss }: { tone?: Tone; children: ReactNode; onDismiss?: () => void }) {
  const colors = tone === "error" ? { background: theme.errorBg, color: theme.errorText } : { background: theme.codeBg, color: theme.text };
  return (
    <div role={tone === "error" ? "alert" : "status"} style={{ ...colors, display: "flex", gap: 12, alignItems: "flex-start", padding: "10px 14px", borderRadius: 8, marginBottom: 12, fontSize: 14 }}>
      <div style={{ flex: 1, minWidth: 0, whiteSpace: "pre-wrap" }}>{children}</div>
      {onDismiss ? (
        <button type="button" onClick={onDismiss} aria-label="Dismiss" style={{ border: "none", background: "transparent", color: "inherit", cursor: "pointer", fontSize: 16, lineHeight: 1 }}>
          ×
        </button>
      ) : null}
    </div>
  );
}
