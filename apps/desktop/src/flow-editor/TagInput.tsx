import { useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { normalizeTags } from "@agentlab/flow-engine";
import { theme } from "../theme.js";
import { inputStyle } from "./styles.js";

interface Props {
  tags: string[];
  onChange: (tags: string[]) => void;
  disabled?: boolean;
}

/** Chips for the current tags plus a text field. Enter or comma adds, Backspace on an empty field removes the last one. */
export function TagInput({ tags, onChange, disabled }: Props) {
  const [draft, setDraft] = useState("");

  const commit = () => {
    if (!draft.trim()) return;
    onChange(normalizeTags([...tags, ...draft.split(",")]));
    setDraft("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit();
    } else if (e.key === "Backspace" && !draft && tags.length > 0) {
      onChange(tags.slice(0, -1));
    }
  };

  return (
    <div style={{ ...inputStyle, display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center", opacity: disabled ? 0.6 : 1 }}>
      {tags.map((tag) => (
        <TagChip key={tag}>
          {tag}
          {!disabled ? (
            <button
              type="button"
              aria-label={`Remove tag ${tag}`}
              style={removeButton}
              onClick={() => onChange(tags.filter((t) => t !== tag))}
            >
              ×
            </button>
          ) : null}
        </TagChip>
      ))}
      <input
        value={draft}
        disabled={disabled}
        placeholder={tags.length ? "" : "Add a tag…"}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={commit}
        style={{ flex: 1, minWidth: 60, border: "none", outline: "none", background: "transparent", color: "inherit", font: "inherit", padding: 0 }}
      />
    </div>
  );
}

export function TagChip({ children, size = "normal" }: { children: ReactNode; size?: "normal" | "small" }) {
  return <span style={size === "small" ? { ...chip, ...smallChip } : chip}>{children}</span>;
}

// Same pill as the agent status badges (Draft / Active / Disabled), in the neutral "disabled" colors.
const chip: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "2px 10px",
  borderRadius: 999,
  background: theme.statusDisabledBg,
  color: theme.statusDisabledText,
  fontSize: 12,
  fontWeight: 600,
  lineHeight: "16px",
  whiteSpace: "nowrap",
};

const smallChip: CSSProperties = { gap: 3, padding: "1px 7px", fontSize: 10, lineHeight: "14px" };

const removeButton: CSSProperties = { background: "none", border: "none", padding: 0, color: "inherit", cursor: "pointer", fontSize: 13, lineHeight: 1 };
