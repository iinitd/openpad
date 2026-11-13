import { StyleSheet, Text, View } from "react-native";
import type { BackendUsage } from "../backend";
import { useSessionStore } from "../stores/session-store";
import { THEME } from "../styles/theme";

function formatTokens(value: number): string {
  if (value < 1000) return `${Math.round(value)}`;
  if (value < 1_000_000) return `${Math.round(value / 100) / 10}k`;
  return `${Math.round(value / 100_000) / 10}M`;
}

function formatCost(value: number): string {
  const digits = value >= 1 ? 2 : value >= 0.01 ? 3 : 4;
  const text = value.toFixed(digits).replace(/0+$/, "").replace(/\.$/, "");
  return `$${text}`;
}

/**
 * One line that summarizes whatever the backend reports. Providers differ in
 * what they expose, so each part only appears when its number is present.
 */
export function describeUsage(usage: BackendUsage | null): string | null {
  if (!usage) return null;
  const totalTokens = [usage.inputTokens, usage.outputTokens, usage.cachedTokens, usage.reasoningTokens]
    .filter((value): value is number => typeof value === "number")
    .reduce((sum, value) => sum + value, 0);
  const parts: string[] = [];
  if (totalTokens > 0) parts.push(`${formatTokens(totalTokens)} tokens`);
  if (typeof usage.costUsd === "number" && usage.costUsd > 0) {
    parts.push(formatCost(usage.costUsd));
  }
  if (typeof usage.contextUsedTokens === "number" && usage.contextUsedTokens > 0) {
    const max = usage.contextMaxTokens;
    if (typeof max === "number" && max > 0) {
      parts.push(`${Math.round((usage.contextUsedTokens / max) * 100)}% context`);
    } else if (totalTokens === 0) {
      // Without a window size the raw number is only worth showing when it is
      // the sole figure; otherwise it just repeats the session total.
      parts.push(`${formatTokens(usage.contextUsedTokens)} context`);
    }
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function SessionUsageRow() {
  const usage = useSessionStore((state) => state.usage);
  const text = describeUsage(usage);
  if (!text) return null;
  return (
    <View style={styles.row} accessibilityLabel={`Session usage, ${text}`}>
      <Text style={styles.label}>Usage</Text>
      <Text style={styles.value} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: THEME.spacing.md,
    paddingHorizontal: THEME.spacing.xs,
    paddingBottom: THEME.spacing.sm,
  },
  label: {
    fontSize: 14,
    color: THEME.colors.textMuted,
  },
  value: {
    flexShrink: 1,
    fontSize: 14,
    color: THEME.colors.textSecondary,
    textAlign: "right",
  },
});
