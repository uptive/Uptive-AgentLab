import type { CSSProperties } from "react";
import { theme } from "../theme.js";

// Same pill / ghost buttons as the Agents view. The primary pill keeps a same-colored border so it
// lines up with ghost buttons beside it.
export const primaryButton: CSSProperties = {
  padding: "8px 18px",
  borderRadius: 999,
  border: `1px solid ${theme.primary}`,
  background: theme.primary,
  color: theme.onPrimary,
  fontFamily: theme.fontBody,
  fontWeight: 500,
  fontSize: 14,
  cursor: "pointer",
};

export const buttonBase: CSSProperties = {
  ...primaryButton,
  border: `1px solid ${theme.border}`,
  background: "transparent",
  color: theme.textSecondary,
};

/** Larger size for page-level actions, as in the Agents view header. */
export const headerButtonSize: CSSProperties = { padding: "10px 20px", fontSize: 15 };

// codeBg (not surface) so inputs read as recessed against the surface-colored panels that contain them.
export const inputStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "6px 8px",
  borderRadius: 6,
  border: `1px solid ${theme.border}`,
  background: theme.codeBg,
  color: theme.text,
  fontFamily: "inherit",
  fontSize: 13,
};

export const preStyle: CSSProperties = {
  margin: 0,
  padding: 8,
  borderRadius: 6,
  background: theme.codeBg,
  border: `1px solid ${theme.border}`,
  color: theme.text,
  fontFamily: theme.fontMono,
  fontSize: 11,
  maxHeight: 360,
  overflow: "auto",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};
