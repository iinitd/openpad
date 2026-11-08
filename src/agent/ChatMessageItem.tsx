import { memo, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { THEME } from "../styles/theme";
import { PressableRow } from "../components/PressableRow";
import { HalfSheet } from "../components/HalfSheet";
import { TypingDots } from "../components/TypingDots";
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
type ActivityItem = ThoughtItem | ToolCallItem;

function toolGlyph(status: ToolCallItem["status"]): string {
  return status === "failed" ? "✕" : status === "running" ? "⚙" : "✓";
}

/**
 * A run of reasoning and tool calls, in the order they happened. Collapsed it
 * is one two-line row built from the newest step; expanding opens a half sheet
 * with the whole run, each step labelled and separated.
 */
export const ActivityRow = memo(function ActivityRow({
  items,
  streaming,
}: {
  items: ActivityItem[];
  streaming?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const latest = items[items.length - 1]!;
  const live = Boolean(streaming) && latest.kind === "tool_call" && latest.status === "running";
  const preview =
    latest.kind === "thought"
      ? latest.text.trim() || "Thinking…"
      : latest.name;
  const prefix = items.length > 1 ? `${items.length} steps · ` : "";

  return (
    <>
      <PressableRow
        style={styles.toolRow}
        onPress={() => setOpen(true)}
        haptic="light"
        accessibilityRole="button"
        accessibilityLabel="Show agent activity"
      >
        <View style={styles.toolMessage}>
          {live ? (
            <TypingDots color={THEME.colors.textMuted} />
          ) : latest.kind === "tool_call" ? (
            <Text style={styles.toolGlyph}>{toolGlyph(latest.status)}</Text>
          ) : (
            <Text style={styles.toolGlyph}>✳</Text>
          )}
          <Text style={styles.toolText} numberOfLines={2}>
            {prefix}
            {preview}
          </Text>
        </View>
      </PressableRow>
      <HalfSheet visible={open} title="Activity" onClose={() => setOpen(false)}>
        {items.map((item, index) => (
          <View key={item.id} style={index > 0 ? styles.sheetSegment : undefined}>
            <Text style={styles.sheetLabel}>
              {item.kind === "thought" ? "Thinking" : "Tool"}
            </Text>
            {item.kind === "thought" ? (
              <Text style={styles.sheetText} selectable>
                {item.text.trim() || "…"}
              </Text>
            ) : (
              <View style={styles.sheetToolRow}>
                <Text style={styles.sheetToolGlyph}>{toolGlyph(item.status)}</Text>
                <Text style={styles.sheetToolName} selectable>
                  {item.name}
                </Text>
              </View>
            )}
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
  sheetLabel: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.08,
    textTransform: "uppercase",
    color: THEME.colors.textMuted,
    marginBottom: 4,
  },
  sheetToolRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: THEME.spacing.sm,
  },
  sheetToolGlyph: {
    width: 16,
    fontSize: 13,
    lineHeight: 21,
    color: THEME.colors.textMuted,
  },
  sheetToolName: {
    flex: 1,
    fontSize: 15,
    lineHeight: 21,
    color: THEME.colors.text,
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
