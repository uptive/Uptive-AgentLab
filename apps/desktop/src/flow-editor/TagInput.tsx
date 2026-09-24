import { useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { normalizeTags } from "@agentlab/flow-engine";
import { alpha, theme } from "../theme.js";
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

interface TagChipProps {
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
  title?: string;
  size?: "normal" | "small";
}

export function TagChip({ children, active, onClick, title, size = "normal" }: TagChipProps) {
  const style: CSSProperties = {
    ...chip,
    ...(size === "small" ? smallChip : {}),
    ...(active ? { background: theme.primary, color: theme.onPrimary } : {}),
    ...(onClick ? { cursor: "pointer" } : {}),
  };
  return onClick ? (
    <button type="button" style={{ ...style, border: "none", font: "inherit", fontSize: style.fontSize, lineHeight: style.lineHeight }} onClick={onClick} title={title}>
      {children}
    </button>
  ) : (
    <span style={style} title={title}>
      {children}
    </span>
  );
}

const chip: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "1px 8px",
  borderRadius: 999,
  background: alpha(theme.primary, 13),
  color: theme.primary,
  fontSize: 11,
  lineHeight: "18px",
  whiteSpace: "nowrap",
};

const smallChip: CSSProperties = { gap: 3, padding: "0 6px", fontSize: 10, lineHeight: "15px" };

const removeButton: CSSProperties = { background: "none", border: "none", padding: 0, color: "inherit", cursor: "pointer", fontSize: 13, lineHeight: 1 };
