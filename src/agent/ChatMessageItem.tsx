import { memo, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { THEME } from "../styles/theme";
import { PressableRow } from "../components/PressableRow";
import { HalfSheet } from "../components/HalfSheet";
import type { StreamItem, ThoughtItem, ToolCallItem } from "../types/stream";

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
  items,
  streaming,
}: {
  count: number;
  latest: ToolCallItem;
  items?: ToolCallItem[];
  streaming?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const stepLabel = count > 1 ? `${count} steps · ` : "";
  const isLive = streaming && latest.status === "running";
  return (
    <>
      <PressableRow
        style={styles.toolRow}
        onPress={() => setOpen(true)}
        haptic="light"
        accessibilityRole="button"
        accessibilityLabel="Show tool steps"
      >
        <View style={styles.toolMessage}>
          {isLive ? (
            <ActivityIndicator size="small" color={THEME.colors.textMuted} style={styles.toolSpinner} />
          ) : (
            <Text style={styles.toolGlyph}>
              {latest.status === "failed" ? "✕" : "✓"}
            </Text>
          )}
          <Text style={styles.toolText} numberOfLines={2}>
            {stepLabel}
            {latest.name}
          </Text>
        </View>
      </PressableRow>
      <HalfSheet visible={open} title="Tool steps" onClose={() => setOpen(false)}>
        {(items ?? [latest]).map((tool) => (
          <View key={tool.id} style={styles.sheetRow}>
            <Text style={styles.sheetGlyph}>
              {tool.status === "failed" ? "✕" : tool.status === "running" ? "⚙" : "✓"}
            </Text>
            <Text style={styles.sheetRowText}>{tool.name}</Text>
          </View>
        ))}
      </HalfSheet>
    </>
  );
});

/**
 * A run of consecutive reasoning segments. Collapsed it shows how many pieces
 * the agent emitted and the newest one; expanding lists them all in order.
 */
export const ThoughtActivityRow = memo(function ThoughtActivityRow({
  items,
}: {
  items: ThoughtItem[];
}) {
  const [open, setOpen] = useState(false);
  const latest = items[items.length - 1]!;
  const preview = latest.text.trim() || "Thinking…";
  return (
    <>
      <PressableRow
        style={[styles.message, styles.thoughtMessage]}
        onPress={() => setOpen(true)}
        haptic="light"
        scale={false}
        accessibilityRole="button"
        accessibilityLabel="Show all reasoning"
      >
        <Text style={styles.thoughtText} numberOfLines={2}>
          {items.length > 1 ? `${items.length} thoughts · ` : ""}
          {preview}
        </Text>
      </PressableRow>
      <HalfSheet visible={open} title="Reasoning" onClose={() => setOpen(false)}>
        {items.map((item, index) => (
          <View key={item.id} style={index > 0 ? styles.sheetSegment : undefined}>
            <Text style={styles.sheetText} selectable>
              {item.text.trim() || "…"}
            </Text>
          </View>
        ))}
      </HalfSheet>
    </>
  );
});

const ThoughtMessage = memo(function ThoughtMessage({
  text,
  status,
}: {
  text: string;
  status?: string;
}) {
  const [open, setOpen] = useState(false);
  const body = text.trim() ? text : status === "loading" ? "Thinking…" : "…";
  const expandable = text.trim().length > 0;
  return (
    <>
      <PressableRow
        style={[styles.message, styles.thoughtMessage]}
        onPress={() => expandable && setOpen(true)}
        disabled={!expandable}
        haptic="light"
        scale={false}
        accessibilityRole={expandable ? "button" : undefined}
        accessibilityLabel={expandable ? "Show full reasoning" : undefined}
      >
        <Text style={styles.thoughtText} numberOfLines={2}>
          {body}
        </Text>
      </PressableRow>
      <HalfSheet visible={open} title="Reasoning" onClose={() => setOpen(false)}>
        <Text style={styles.sheetText}>{text}</Text>
      </HalfSheet>
    </>
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
      return <ThoughtMessage text={item.text} status={item.status} />;
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
  toolRow: {
    alignSelf: "flex-start",
    marginVertical: 2,
    paddingHorizontal: THEME.spacing.xs,
    paddingVertical: 2,
    borderRadius: 6,
  },
  toolMessage: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
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
  sheetSegment: {
    marginTop: THEME.spacing.lg,
    paddingTop: THEME.spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: THEME.colors.border,
  },
  sheetText: {
    fontSize: 15,
    lineHeight: 23,
    color: THEME.colors.text,
  },
  sheetRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: THEME.spacing.sm,
    paddingVertical: 6,
  },
  sheetGlyph: {
    width: 16,
    fontSize: 13,
    lineHeight: 21,
    color: THEME.colors.textMuted,
  },
  sheetRowText: {
    flex: 1,
    fontSize: 15,
    lineHeight: 21,
    color: THEME.colors.text,
  },
});
