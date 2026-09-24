import type { CSSProperties, ReactNode } from "react";
import { theme } from "../theme.js";

// Small shared building blocks for the Tools & skills view and the agent editor pickers.

export const titleStyle: CSSProperties = { fontFamily: theme.fontTitle, fontWeight: 600, color: theme.title, margin: 0 };

export const primaryButton: CSSProperties = {
  padding: "8px 16px",
  borderRadius: 999,
  border: "none",
  background: theme.primary,
  color: theme.onPrimary,
  fontFamily: theme.fontBody,
  fontWeight: 500,
  fontSize: 13,
  cursor: "pointer",
};

export const ghostButton: CSSProperties = {
  ...primaryButton,
  background: "transparent",
  color: theme.textSecondary,
  border: `1px solid ${theme.border}`,
};

export const dangerButton: CSSProperties = { ...ghostButton, color: theme.errorText, borderColor: theme.errorBg };

export const input: CSSProperties = {
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

export const codeInput: CSSProperties = { ...input, fontFamily: theme.fontMono, fontSize: 13, lineHeight: 1.5, background: theme.codeBg };

export function Card({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        border: `1px solid ${theme.border}`,
        borderRadius: 10,
        background: theme.surface,
        boxShadow: theme.cardShadow,
        padding: 16,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function Label({ text, hint, children }: { text: string; hint?: string; children: ReactNode }) {
  return (
    <label style={{ display: "block", marginBottom: 16 }}>
      <span style={{ display: "block", fontSize: 13, fontWeight: 500, color: theme.textSecondary, marginBottom: hint ? 2 : 6 }}>{text}</span>
      {hint ? <span style={{ display: "block", fontSize: 12, color: theme.textMuted, marginBottom: 6 }}>{hint}</span> : null}
      {children}
    </label>
  );
}

export function Pill({ children, tone = "muted" }: { children: ReactNode; tone?: "ok" | "warn" | "error" | "muted" }) {
  const colors = {
    ok: { background: theme.statusActive, color: theme.onStatus },
    warn: { background: theme.warning, color: theme.onStatus },
    error: { background: theme.danger, color: theme.onStatus },
    muted: { background: theme.statusDisabledBg, color: theme.statusDisabledText },
  }[tone];
  return (
    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 600, whiteSpace: "nowrap", ...colors }}>
      {children}
    </span>
  );
}

export function Banner({ children, onDismiss, tone = "error" }: { children: ReactNode; onDismiss?: () => void; tone?: "error" | "info" }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      style={{
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
        padding: "10px 14px",
        marginBottom: 16,
        borderRadius: 8,
        fontSize: 13,
        background: tone === "error" ? theme.errorBg : theme.codeBg,
        color: tone === "error" ? theme.errorText : theme.text,
        border: tone === "error" ? "none" : `1px solid ${theme.border}`,
      }}
    >
      <div style={{ flex: 1, whiteSpace: "pre-wrap" }}>{children}</div>
      {onDismiss ? (
        <button type="button" onClick={onDismiss} aria-label="Dismiss" style={{ border: "none", background: "none", color: "inherit", cursor: "pointer" }}>
          ✕
        </button>
      ) : null}
    </div>
  );
}

export function Check({
  checked,
  onChange,
  label,
  description,
  warning,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  warning?: boolean;
  disabled?: boolean;
}) {
  return (
    <label style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "6px 0", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.6 : 1 }}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} style={{ marginTop: 3 }} />
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 14, color: theme.text }}>
          {label}
          {warning ? <span style={{ marginLeft: 8, fontSize: 11, color: theme.warning }}>can change your computer</span> : null}
        </span>
        {description ? <span style={{ display: "block", fontSize: 12, color: theme.textMuted }}>{description}</span> : null}
      </span>
    </label>
  );
}
