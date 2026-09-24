export const colors = {
  accent: "#6EEBA1",
  secondary: "#FDFDFD",
  bgBlack: "#202123",
  bgGrey: "#313131",
  bgCard: "#505050",
  warning: "#F5B942",
  danger: "#F26D6D",
  muted: "#8A8D91",
} as const;

export type ThemeColor = keyof typeof colors;
