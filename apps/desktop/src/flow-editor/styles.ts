import type { CSSProperties } from "react";
import { theme } from "../theme.js";

export const buttonBase: CSSProperties = {
  padding: "6px 12px",
  borderRadius: 6,
  border: `1px solid ${theme.border}`,
  background: theme.surface,
  color: theme.text,
  cursor: "pointer",
  fontSize: 13,
};

export const primaryButton: CSSProperties = {
  ...buttonBase,
  border: `1px solid ${theme.primary}`,
  background: theme.primary,
  color: theme.onPrimary,
  fontWeight: 600,
};

export const inputStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "6px 8px",
  borderRadius: 6,
  border: `1px solid ${theme.border}`,
  background: theme.surface,
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
