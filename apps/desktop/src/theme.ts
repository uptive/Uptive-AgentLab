import { useSyncExternalStore } from "react";

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
  warning: "var(--color-warning)",
  danger: "var(--color-danger)",
  surfaceSelected: "var(--color-surface-selected)",
  errorBg: "var(--color-error-bg)",
  errorText: "var(--color-error-text)",
  cardShadow: "var(--shadow-card)",
  drawerShadow: "var(--shadow-drawer)",
  backdrop: "var(--color-backdrop)",
  canvasBg: "var(--color-canvas-bg)",
  canvasGrid: "var(--color-canvas-grid)",
  edge: "var(--color-edge)",
  idle: "var(--color-idle)",
  nodeShadow: "var(--shadow-node)",
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

// Shared across every useTheme() call (e.g. the sidebar toggle and the flow editor's canvas), so
// choosing a mode in one place updates them all instead of each hook instance tracking its own.
let currentMode: ThemeMode = storedMode() ?? systemMode();
const listeners = new Set<() => void>();

function setGlobalMode(mode: ThemeMode) {
  currentMode = mode;
  apply(mode);
  for (const listener of listeners) listener();
}

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
  // Follow OS changes only while the user hasn't picked a mode themselves.
  if (!storedMode()) setGlobalMode(e.matches ? "dark" : "light");
});

/** Call once before the first render so the page never flashes the wrong theme. */
export function initTheme() {
  apply(currentMode);
}

/** Mixes a token with transparency, e.g. alpha(theme.danger, 13) for a faint tint. */
export const alpha = (color: string, percent: number) => `color-mix(in srgb, ${color} ${percent}%, transparent)`;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The active mode, for libraries that need it as a prop (e.g. React Flow's colorMode). Reactive, without the setter useTheme() carries. */
export function useThemeMode(): ThemeMode {
  return useSyncExternalStore(subscribe, () => currentMode);
}

/** Current mode plus a setter. Choosing a mode remembers it; until then the OS setting is followed. */
export function useTheme() {
  const mode = useSyncExternalStore(subscribe, () => currentMode);

  function choose(next: ThemeMode) {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not persisted; the choice still applies for this session.
    }
    setGlobalMode(next);
  }

  return { mode, setMode: choose, toggle: () => choose(currentMode === "dark" ? "light" : "dark") };
}
