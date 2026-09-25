import type { ButtonHTMLAttributes, CSSProperties } from "react";
import { theme } from "../theme.js";

// Shared button (see CODE_INSTRUCTIONS.md, Frontend). Views should use this instead of their own styles.

type Variant = "primary" | "secondary";

const base: CSSProperties = {
  padding: "8px 18px",
  borderRadius: 999,
  fontFamily: theme.fontBody,
  fontWeight: 500,
  fontSize: 14,
  cursor: "pointer",
};

const variants: Record<Variant, CSSProperties> = {
  primary: { border: "none", background: theme.primary, color: theme.onPrimary },
  secondary: { border: `1px solid ${theme.border}`, background: "transparent", color: theme.textSecondary },
};

export function Button({ variant = "secondary", style, disabled, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      disabled={disabled}
      style={{ ...base, ...variants[variant], ...(disabled ? { opacity: 0.5, cursor: "not-allowed" } : {}), ...style }}
      {...props}
    />
  );
}
