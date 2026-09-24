export const colors = {
  accent: "#6EEBA1",
  secondary: "#FDFDFD",
  bgBlack: "#202123",
  bgGrey: "#313131",
  bgCard: "#505050",
} as const;

export type ThemeColor = keyof typeof colors;

// Accruent Design System, light theme. Used by views that follow the ADS screen designs.
export const ads = {
  pageBg: "#F7F8FA",
  surface: "#FFFFFF",
  border: "#E5E5E5",
  navy: "#001C71",
  text: "#222223",
  textSecondary: "#5A5E68",
  textMuted: "#80858F",
  primary: "#007AC9",
  statusActive: "#1F8A5B",
  statusDraft: "#80858F",
  statusDisabledBg: "#D2D5DB",
  statusDisabledText: "#3D4047",
  errorBg: "#FBE4E5",
  errorText: "#8E191F",
  cardShadow: "0 1px 3px rgba(0,28,113,.08), 0 1px 2px rgba(0,28,113,.06)",
  drawerShadow: "-24px 0 56px rgba(0,28,113,.18)",
  backdrop: "rgba(0,28,113,.25)",
  fontTitle: "Poppins, system-ui, sans-serif",
  fontBody: "Roboto, system-ui, sans-serif",
  fontMono: 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, monospace',
} as const;
