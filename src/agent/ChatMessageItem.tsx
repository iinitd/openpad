import { memo } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { THEME } from "../styles/theme";
import type { StreamItem, ToolCallItem } from "../types/stream";

interface Props {
  item: StreamItem;
}

// A collapsed activity row for a run of tool calls: shows only how many steps
// ran and what the latest step is doing, so a burst of edits stays a single
// compact line instead of stacking one bulky row per call. When the agent is
// still streaming (and this is the newest row), the leading glyph is a spinner
// so the step row itself doubles as the "AI is working" indicator — no
// separate badge needed below the list.
export const ToolActivityRow = memo(function ToolActivityRow({
  count,
  latest,
  streaming,
}: {
  count: number;
  latest: ToolCallItem;
  streaming?: boolean;
}) {
  const stepLabel = count > 1 ? `${count} steps · ` : "";
  const isLive = streaming && latest.status === "running";
  return (
    <View style={styles.toolMessage}>
      {isLive ? (
        <ActivityIndicator size="small" color={THEME.colors.textMuted} style={styles.toolSpinner} />
      ) : (
        <Text style={styles.toolGlyph}>
          {latest.status === "failed" ? "✕" : "✓"}
        </Text>
      )}
      <Text style={styles.toolText} numberOfLines={1}>
        {stepLabel}
        {latest.name}
      </Text>
    </View>
  );
});

export const ChatMessageItem = memo(function ChatMessageItem({ item }: Props) {
  switch (item.kind) {
    case "user_message":
      return (
        <View style={[styles.message, styles.userMessage]}>
          <Text style={styles.userText} selectable>{item.text}</Text>
        </View>
      );
    case "assistant_message":
      return (
        <View style={[styles.message, styles.assistantMessage]}>
          <Text style={styles.assistantText} selectable>{item.text || "..."}</Text>
        </View>
      );
    case "thought":
      return (
        <View style={[styles.message, styles.thoughtMessage]}>
          <Text style={styles.thoughtText} selectable>
            {item.text
              ? item.text
              : item.status === "loading"
                ? "Thinking…"
                : "…"}
          </Text>
        </View>
      );
    case "tool_call":
      // Tool calls are normally collapsed into ToolActivityRow by the panel;
      // this fallback keeps a single stray call compact.
      return (
        <View style={styles.toolMessage}>
          <Text style={styles.toolText} numberOfLines={1}>
            {item.status === "running" ? "⚙" : item.status === "failed" ? "✕" : "✓"} {item.name}
          </Text>
        </View>
      );
    case "error":
      return (
        <View style={[styles.message, styles.errorMessage]}>
          <Text style={styles.errorText} selectable>⚠ {item.message}</Text>
        </View>
      );
  }
});

const styles = StyleSheet.create({
  message: {
    marginVertical: 5,
    paddingHorizontal: THEME.spacing.md,
    paddingVertical: 10,
    borderRadius: THEME.radii.xl,
    maxWidth: "90%",
  },
  userMessage: {
    alignSelf: "flex-end",
    backgroundColor: "#e7edf3",
    borderBottomRightRadius: THEME.radii.sm,
  },
  userText: {
    color: THEME.colors.text,
    fontSize: 16,
    lineHeight: 24,
  },
  assistantMessage: {
    alignSelf: "flex-start",
    backgroundColor: THEME.colors.background,
    borderBottomLeftRadius: THEME.radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#e1e7ed",
  },
  assistantText: {
    color: THEME.colors.text,
    fontSize: 16,
    lineHeight: 24,
  },
  thoughtMessage: {
    alignSelf: "flex-start",
    backgroundColor: "transparent",
    paddingVertical: 2,
    paddingHorizontal: THEME.spacing.xs,
  },
  thoughtText: {
    color: THEME.colors.textMuted,
    fontSize: 14,
    fontStyle: "italic",
    lineHeight: 20,
  },
  toolMessage: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "transparent",
    paddingVertical: 1,
    marginVertical: 2,
    paddingHorizontal: THEME.spacing.xs,
  },
  toolSpinner: {
    transform: [{ scale: 0.7 }],
    marginRight: -2,
  },
  toolGlyph: {
    color: THEME.colors.textMuted,
    fontSize: 13,
    opacity: 0.8,
  },
  toolText: {
    color: THEME.colors.textMuted,
    fontSize: 13,
    opacity: 0.8,
  },
  errorMessage: {
    alignSelf: "flex-start",
    backgroundColor: "#fef2f2",
  },
  errorText: {
    color: THEME.colors.error,
    fontSize: 15,
    lineHeight: 22,
  },
});
