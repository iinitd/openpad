import { memo, useMemo, useState } from "react";
import { Pressable, View, Text, StyleSheet } from "react-native";
import { THEME } from "../styles/theme";
import { PressableRow, hapticTap } from "../components/PressableRow";
import { HalfSheet } from "../components/HalfSheet";
import { ActivityDot } from "../components/TypingDots";
import { Icon } from "../components/Icon";
import { MarkdownText, markdownPlainText } from "../components/MarkdownText";
import { SelectableText } from "../components/SelectableText";
import { hapticLongPress, SelectableSheet } from "../components/SelectableSheet";
import { summarizeActivity } from "../hooks/use-agent-progress";
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
 * The header line of one step in the activity sheet: the kind on the left, the
 * content on the right, one line each. It is its own child of the sheet's
 * scroll view so it can stay pinned while a long reasoning body scrolls under
 * it.
 */
const ActivityStepHeader = memo(function ActivityStepHeader({
  item,
  first,
  open,
  onToggle,
}: {
  item: ActivityItem;
  first: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const isThought = item.kind === "thought";
  const text = isThought ? item.text.trim() || "…" : item.name;
  const failed = item.kind === "tool_call" && item.status === "failed";
  return (
    <Pressable
      style={({ pressed }) => [
        styles.stepRow,
        first ? null : styles.stepDivider,
        // A translucent press tint would let the text scrolling under a pinned
        // header show through, so the feedback is an opaque surface shift.
        pressed ? styles.stepRowPressed : null,
      ]}
      disabled={!isThought}
      onPressIn={() => hapticTap("light")}
      onPress={onToggle}
      accessibilityRole={isThought ? "button" : undefined}
      accessibilityLabel={
        isThought ? (open ? "Collapse thinking" : "Expand thinking") : undefined
      }
    >
      <Text style={[styles.stepLabel, failed ? styles.stepFailed : null]}>
        {isThought ? "Thinking" : "Tool"}
      </Text>
      <Text
        style={[styles.stepPreview, failed ? styles.stepFailed : null]}
        numberOfLines={1}
      >
        {text}
      </Text>
      {isThought ? (
        <Icon
          name={open ? "chevron-up" : "chevron-down"}
          size={14}
          color={THEME.colors.textMuted}
        />
      ) : null}
    </Pressable>
  );
});

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
  // One implementation for the transcript row and the document banner: the
  // header names the newest action honestly, the body carries the most recent
  // reasoning, and a command name never stands in for the agent's own words.
  const summary = summarizeActivity(items);
  const headerLabel = summary?.label ?? "";
  const preview = summary?.preview ?? "";
  // The sheet opens the step the turn is actually on, and only when that step
  // is reasoning: a run that ends on a command has nothing to read past its
  // one-line row.
  const autoOpenId = latest.kind === "thought" ? latest.id : null;
  // Steps the reader has opened or closed by hand; everything else follows the
  // automatic rule above.
  const [manualOpen, setManualOpen] = useState<Record<string, boolean>>({});

  return (
    <>
      <PressableRow
        style={styles.activityRow}
        onPress={() => setOpen(true)}
        // Either gesture opens the run; a tap is the quick one, a hold is what
        // people try when they want to read without navigating.
        onLongPress={() => setOpen(true)}
        delayLongPress={300}
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
          <Text style={styles.activityLabel} numberOfLines={1}>
            {headerLabel}
          </Text>
          {items.length > 1 ? (
            <Text style={styles.activityMeta}>{items.length} steps</Text>
          ) : null}
        </View>
        {preview ? (
          <View style={styles.activityQuote}>
            <Text style={styles.activityPreview} numberOfLines={2}>
              {preview}
            </Text>
          </View>
        ) : null}
      </PressableRow>
      <HalfSheet
        visible={open}
        title="Activity"
        onClose={() => setOpen(false)}
        scrollToEndOnOpen
        // Header and body are separate children, two per step, so the headers
        // sit at the even indices and stay pinned while their body scrolls.
        stickyHeaderIndices={items.map((_, index) => index * 2)}
      >
        {items.flatMap((item, index) => {
          const isThought = item.kind === "thought";
          const expanded =
            isThought && (manualOpen[item.id] ?? item.id === autoOpenId);
          return [
            <ActivityStepHeader
              key={`${item.id}-header`}
              item={item}
              first={index === 0}
              open={expanded}
              onToggle={() => {
                if (!isThought) return;
                setManualOpen((prev) => ({ ...prev, [item.id]: !expanded }));
              }}
            />,
            expanded ? (
              <SelectableText
                key={`${item.id}-body`}
                text={item.text.trim() || "…"}
                style={styles.stepBody}
              />
            ) : (
              <View key={`${item.id}-body`} />
            ),
          ];
        })}
      </HalfSheet>
    </>
  );
});

const AssistantBubble = memo(function AssistantBubble({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const plain = useMemo(() => markdownPlainText(text), [text]);
  return (
    <>
      <Pressable
        style={[styles.message, styles.assistantMessage]}
        delayLongPress={300}
        onLongPress={() => {
          hapticLongPress();
          setOpen(true);
        }}
      >
        <MarkdownText text={text} />
      </Pressable>
      {open ? <SelectableSheet text={plain} onClose={() => setOpen(false)} /> : null}
    </>
  );
});

const UserBubble = memo(function UserBubble({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        style={[styles.message, styles.userMessage]}
        delayLongPress={300}
        onLongPress={() => {
          hapticLongPress();
          setOpen(true);
        }}
      >
        <Text style={styles.userText}>{text}</Text>
      </Pressable>
      {open ? <SelectableSheet text={text} onClose={() => setOpen(false)} /> : null}
    </>
  );
});

export const ChatMessageItem = memo(function ChatMessageItem({ item }: Props) {
  switch (item.kind) {
    case "user_message":
      // An image-only prompt carries no text; an empty bubble would read as a
      // rendering fault.
      return item.text.trim() ? <UserBubble text={item.text} /> : null;
    case "assistant_message":
      return <AssistantBubble text={item.text || "..."} />;
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
  // Only the content sits inside the rule; the label line reads as a caption.
  // The rule's centre sits on the indicator's centre: the 14pt dot slot centres
  // its dot at 7, so a 2pt rule starts at 6. The text then lands on the label.
  activityQuote: {
    marginTop: 4,
    marginLeft: 6,
    paddingLeft: THEME.spacing.sm + 4,
    borderLeftWidth: 2,
    borderLeftColor: "#ececef",
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
    // One step lighter than the muted token: the preview is context, not copy.
    color: "#b3b3bc",
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
  stepDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: THEME.colors.border,
  },
  stepRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: THEME.spacing.sm,
    paddingVertical: 9,
    // Pinned headers must cover the text scrolling underneath them.
    backgroundColor: THEME.colors.background,
  },
  stepRowPressed: {
    backgroundColor: THEME.colors.surface,
  },
  // Fixed width so every step's content starts on the same column.
  stepLabel: {
    width: 62,
    fontSize: 12,
    fontWeight: "600",
    color: THEME.colors.textMuted,
  },
  stepPreview: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    color: THEME.colors.textSecondary,
  },
  stepFailed: {
    color: THEME.colors.error,
  },
  // Sits on the content column, not under the label.
  stepBody: {
    marginLeft: 62 + THEME.spacing.sm,
    marginTop: -2,
    paddingBottom: 10,
    fontSize: 14,
    lineHeight: 22,
    color: THEME.colors.text,
  },
});
