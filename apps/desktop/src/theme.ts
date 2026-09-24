import { useEffect, useState } from "react";

// Design tokens for inline styles. Each value is a CSS variable defined in theme.css, so it
// follows the active light/dark theme automatically. Never put raw colors in components.
export const theme = {
  pageBg: "var(--color-page-bg)",
  surface: "var(--color-surface)",
  sidebarBg: "var(--color-sidebar-bg)",
  border: "var(--color-border)",
  title: "var(--color-title)",
  text: "var(--color-text)",
  textSecondary: "var(--color-text-secondary)",
  textMuted: "var(--color-text-muted)",
  primary: "var(--color-primary)",
  onPrimary: "var(--color-on-primary)",
  navActiveBg: "var(--color-nav-active-bg)",
  navActiveText: "var(--color-nav-active-text)",
  codeBg: "var(--color-code-bg)",
  statusActive: "var(--color-status-active)",
  statusDraft: "var(--color-status-draft)",
  statusDisabledBg: "var(--color-status-disabled-bg)",
  statusDisabledText: "var(--color-status-disabled-text)",
  onStatus: "var(--color-on-status)",
  errorBg: "var(--color-error-bg)",
  errorText: "var(--color-error-text)",
  cardShadow: "var(--shadow-card)",
  drawerShadow: "var(--shadow-drawer)",
  backdrop: "var(--color-backdrop)",
  fontTitle: "var(--font-title)",
  fontBody: "var(--font-body)",
  fontMono: "var(--font-mono)",
} as const;

export type ThemeToken = keyof typeof theme;

export type ThemeMode = "light" | "dark";

const STORAGE_KEY = "agentlab.theme";

function storedMode(): ThemeMode | undefined {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : undefined;
  } catch {
    return undefined;
  }
}

function systemMode(): ThemeMode {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function apply(mode: ThemeMode) {
  document.documentElement.dataset.theme = mode;
}

/** Call once before the first render so the page never flashes the wrong theme. */
export function initTheme() {
  apply(storedMode() ?? systemMode());
}

/** Current mode plus a setter. Choosing a mode remembers it; until then the OS setting is followed. */
export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(() => storedMode() ?? systemMode());

  useEffect(() => {
    apply(mode);
  }, [mode]);

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    // Follow OS changes only while the user hasn't picked a mode themselves.
    const onChange = () => {
      if (!storedMode()) setMode(query.matches ? "dark" : "light");
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  function choose(next: ThemeMode) {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not persisted; the choice still applies for this session.
    }
    setMode(next);
  }

  return { mode, setMode: choose, toggle: () => choose(mode === "dark" ? "light" : "dark") };
}
