import { theme } from "../theme.js";

/** An On/Off switch for boolean fields. */
export function Toggle({ id, checked, onChange }: { id: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", padding: 0, cursor: "pointer", color: theme.text, fontSize: 13 }}
    >
      <span
        style={{
          position: "relative",
          width: 34,
          height: 20,
          borderRadius: 999,
          background: checked ? theme.primary : theme.codeBg,
          border: `1px solid ${checked ? theme.primary : theme.border}`,
          transition: "background 120ms",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 2,
            left: checked ? 16 : 2,
            width: 14,
            height: 14,
            borderRadius: "50%",
            background: checked ? theme.onPrimary : theme.textMuted,
            transition: "left 120ms",
          }}
        />
      </span>
      {checked ? "On" : "Off"}
    </button>
  );
}
