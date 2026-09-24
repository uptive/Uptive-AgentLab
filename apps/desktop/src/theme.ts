export const colors = {
  accent: "#6EEBA1",
  secondary: "#FDFDFD",
  bgBlack: "#202123",
  bgGrey: "#313131",
  bgCard: "#505050",
} as const;

export type ThemeColor = keyof typeof colors;
