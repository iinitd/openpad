import { memo, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { THEME } from "../styles/theme";
import { PressableRow } from "../components/PressableRow";
import { HalfSheet } from "../components/HalfSheet";
import { ActivityDot } from "../components/TypingDots";
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

function StatusDot({ status }: { status: ToolCallItem["status"] }) {
  return (
    <View
      style={[
        styles.statusDot,
        status === "failed" ? styles.statusDotFailed : null,
      ]}
    />
  );
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
  // The row is live while the turn runs, and also while the newest step itself
  // is still being produced — a thought can arrive before the streaming flag
  // settles, and that should still read as working.
  const live =
    Boolean(streaming) ||
    (latest.kind === "thought"
      ? latest.status === "loading"
      : latest.status === "running");
  // Prefer the newest thing the agent actually said over whatever it happens to
  // be running: a row that only ever shows command names tells the reader
  // nothing about the work.
  const lastThought = [...items]
    .reverse()
    .find(
      (entry): entry is ThoughtItem =>
        entry.kind === "thought" && entry.text.trim().length > 0,
    );
  const isThought = Boolean(lastThought);
  const preview = lastThought
    ? lastThought.text.trim()
    : latest.kind === "tool_call"
      ? latest.name
      : "Thinking…";

  return (
    <>
      <PressableRow
        style={styles.activityRow}
        onPress={() => setOpen(true)}
        haptic="light"
        scale={false}
        accessibilityRole="button"
        accessibilityLabel="Show agent activity"
      >
        <View style={styles.activityHeader}>
          <ActivityDot
            running={live}
            color={
              latest.kind === "tool_call" && latest.status === "failed"
                ? THEME.colors.error
                : "#c6c6ce"
            }
          />
          <Text style={styles.activityLabel}>{isThought ? "Thinking" : "Tool"}</Text>
          {items.length > 1 ? (
            <Text style={styles.activityMeta}>{items.length} steps</Text>
          ) : null}
        </View>
        <Text style={styles.activityPreview} numberOfLines={2}>
          {preview}
        </Text>
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
                <View style={styles.sheetToolDotWrap}>
                  <StatusDot status={item.status} />
                </View>
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
          <Text style={styles.thoughtText} selectable numberOfLines={2}>
            {item.text ? item.text : item.status === "loading" ? "Thinking…" : "…"}
          </Text>
        </View>
      );
    case "tool_call":
      // Tool calls are normally collapsed into ToolActivityRow by the panel;
      // this fallback keeps a single stray call compact.
      return (
        <View style={styles.toolMessage}>
          <StatusDot status={item.status} />
          <Text style={styles.toolText} numberOfLines={1}>
            {item.name}
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
  activityRow: {
    alignSelf: "stretch",
    marginHorizontal: THEME.spacing.sm,
    paddingHorizontal: THEME.spacing.xs,
    paddingVertical: 7,
  },
  activityHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  activityMeta: {
    fontSize: 11,
    color: THEME.colors.textMuted,
  },
  toolMessage: {
    flexDirection: "row",
    alignItems: "center",
  },
  statusDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: THEME.colors.border,
  },
  statusDotFailed: {
    backgroundColor: THEME.colors.error,
  },
  toolText: {
    color: THEME.colors.textMuted,
    fontSize: 13,
    opacity: 0.8,
  },
  activityLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: THEME.colors.textMuted,
  },
  activityPreview: {
    marginTop: 4,
    color: THEME.colors.textMuted,
    fontSize: 14,
    lineHeight: 19,
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
  sheetToolDotWrap: {
    width: 16,
    paddingTop: 8,
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
