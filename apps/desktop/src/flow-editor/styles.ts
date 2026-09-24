import type { CSSProperties } from "react";
import { colors } from "../theme.js";

export const buttonBase: CSSProperties = {
  padding: "6px 12px",
  borderRadius: 6,
  border: `1px solid ${colors.bgCard}`,
  background: colors.bgGrey,
  color: colors.secondary,
  cursor: "pointer",
  fontSize: 13,
};

export const primaryButton: CSSProperties = {
  ...buttonBase,
  background: colors.accent,
  color: colors.bgBlack,
  fontWeight: 600,
};

export const inputStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "6px 8px",
  borderRadius: 6,
  border: `1px solid ${colors.bgCard}`,
  background: colors.bgBlack,
  color: colors.secondary,
  fontFamily: "inherit",
  fontSize: 13,
};

export const preStyle: CSSProperties = {
  margin: 0,
  padding: 8,
  borderRadius: 6,
  background: colors.bgBlack,
  fontSize: 11,
  maxHeight: 360,
  overflow: "auto",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};
