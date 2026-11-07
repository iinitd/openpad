import { Platform } from "react-native";

export const THEME = {
  colors: {
    // Ink and paper, with a single indigo accent reserved for interaction.
    primary: "#18181b",
    primaryLight: "#3f3f46",
    accent: "#5b5bd6",
    accentSoft: "#eeeefe",
    background: "#ffffff",
    backgroundSecondary: "#fafafa",
    surface: "#f4f4f5",
    border: "#e9e9ec",
    text: "#18181b",
    textSecondary: "#71717a",
    textMuted: "#a1a1aa",
    annotation: "#fef08a",
    annotationBorder: "#eab308",
    success: "#22c55e",
    error: "#ef4444",
    warning: "#f59e0b",
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    xxl: 32,
  },
  radii: {
    sm: 6,
    md: 8,
    lg: 12,
    xl: 16,
    full: 9999,
  },
  fonts: {
    sans: Platform.select({ web: "Inter, system-ui, sans-serif", default: "System" }) as string,
    mono: Platform.select({ web: "JetBrains Mono, monospace", default: "Courier" }) as string,
  },
} as const;
