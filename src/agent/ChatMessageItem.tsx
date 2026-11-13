import { memo, useMemo, useState } from "react";
import { Image, Pressable, View, Text, StyleSheet } from "react-native";
import { THEME } from "../styles/theme";
import { PressableRow, hapticTap } from "../components/PressableRow";
import { HalfSheet } from "../components/HalfSheet";
import { ActivityDot } from "../components/TypingDots";
import { Icon } from "../components/Icon";
import { MarkdownText, markdownPlainText } from "../components/MarkdownText";
import { SelectableText } from "../components/SelectableText";
import { hapticLongPress, SelectableSheet } from "../components/SelectableSheet";
import { ImageViewer } from "../components/ImageViewer";
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
function toolHeaderText(item: ToolCallItem): string {
  const detail = item.detail?.trim();
  if (detail) return detail;
  const input = item.input as Record<string, unknown> | undefined;
  if (input && typeof input === "object") {
    for (const key of ["command", "cmd"]) {
      const value = input[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    for (const key of ["filePath", "path", "file", "pattern", "query", "url"]) {
      const value = input[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  return item.name;
}

function toolBodyText(item: ToolCallItem): string {
  const lines: string[] = [];
  lines.push(`Tool: ${item.name}`);
  lines.push(`Status: ${item.status}`);
  if (item.detail?.trim()) lines.push(`Detail: ${item.detail.trim()}`);
  if (item.input !== undefined) {
    try {
      const input = item.input as unknown;
      if (input && typeof input === "object" && !Array.isArray(input)) {
        const entries = Object.entries(input as Record<string, unknown>);
        if (entries.length > 0) {
          lines.push("Input:");
          for (const [key, value] of entries) {
            if (value === undefined || value === null || value === "") continue;
            const text =
              typeof value === "string"
                ? value
                : typeof value === "number" || typeof value === "boolean"
                  ? String(value)
                  : JSON.stringify(value);
            lines.push(`${key}: ${text}`);
          }
        }
      } else if (typeof input === "string" && input.trim()) {
        lines.push(`Input: ${input}`);
      }
    } catch {
      // Ignore non-serializable tool input.
    }
  }
  return lines.join("\n");
}

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
  const isTool = item.kind === "tool_call";
  const text = isThought ? item.text.trim() || "…" : toolHeaderText(item);
  const failed = isTool && item.status === "failed";
  const label = isThought ? "Thinking" : isTool && (item.name === "shell" || item.name === "bash") ? "Shell" : "Tool";
  return (
    <Pressable
      style={({ pressed }) => [
        styles.stepRow,
        first ? null : styles.stepDivider,
        // A translucent press tint would let the text scrolling under a pinned
        // header show through, so the feedback is an opaque surface shift.
        pressed ? styles.stepRowPressed : null,
      ]}
      onPressIn={() => hapticTap("light")}
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityLabel={open ? "Collapse activity step" : "Expand activity step"}
      accessibilityState={{ expanded: open }}
    >
      <Text style={[styles.stepLabel, failed ? styles.stepFailed : null]}>
        {label}
      </Text>
      <Text
        style={[styles.stepPreview, failed ? styles.stepFailed : null]}
        numberOfLines={1}
      >
        {text}
      </Text>
      <Icon
        name={open ? "chevron-up" : "chevron-down"}
        size={14}
        color={THEME.colors.textMuted}
      />
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
  // The sheet opens the step the turn is actually on by default.
  const autoOpenId = latest.id;
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
          const expanded = manualOpen[item.id] ?? item.id === autoOpenId;
          const bodyText =
            item.kind === "thought"
              ? item.text.trim() || "…"
              : toolBodyText(item);
          return [
            <ActivityStepHeader
              key={`${item.id}-header`}
              item={item}
              first={index === 0}
              open={expanded}
              onToggle={() => {
                setManualOpen((prev) => ({ ...prev, [item.id]: !expanded }));
              }}
            />,
            expanded ? (
              <SelectableText
                key={`${item.id}-body`}
                text={bodyText}
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
        delayLongPress={250}
        onLongPress={() => {
          hapticLongPress();
          setOpen(true);
        }}
      >
        <MarkdownText text={text} />
      </Pressable>
      <SelectableSheet
        visible={open}
        text={plain}
        onClose={() => setOpen(false)}
      />
    </>
  );
});

const UserBubble = memo(function UserBubble({
  text,
  images,
}: {
  text: string;
  images?: string[];
}) {
  const [open, setOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const hasText = text.trim().length > 0;
  return (
    <>
      <Pressable
        style={[styles.message, styles.userMessage]}
        delayLongPress={250}
        onLongPress={
          hasText
            ? () => {
                hapticLongPress();
                setOpen(true);
              }
            : undefined
        }
      >
        {images && images.length > 0 ? (
          <View style={styles.userImages}>
            {images.map((uri, index) => (
              <Pressable
                key={`${index}-${uri.length}`}
                onPress={() => {
                  hapticTap("light");
                  setViewerIndex(index);
                }}
                accessibilityRole="imagebutton"
                accessibilityLabel={`Open image ${index + 1} of ${images.length}`}
              >
                <Image
                  source={{ uri }}
                  style={styles.userImage}
                  resizeMode="cover"
                />
              </Pressable>
            ))}
          </View>
        ) : null}
        {hasText ? <Text style={styles.userText}>{text}</Text> : null}
      </Pressable>
      <SelectableSheet
        visible={open}
        text={text}
        onClose={() => setOpen(false)}
      />
      <ImageViewer
        images={images ?? []}
        index={viewerIndex}
        onClose={() => setViewerIndex(null)}
      />
    </>
  );
});

export const ChatMessageItem = memo(function ChatMessageItem({ item }: Props) {
  switch (item.kind) {
    case "user_message":
      // An image-only prompt has no text but still needs its bubble.
      return item.text.trim() || (item.images?.length ?? 0) > 0 ? (
        <UserBubble text={item.text} images={item.images} />
      ) : null;
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
            {item.detail?.trim() || item.name}
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
    backgroundColor: "#ececef",
    borderBottomRightRadius: THEME.radii.sm,
  },
  userImages: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 6,
  },
  userImage: {
    width: 140,
    height: 140,
    borderRadius: 12,
    backgroundColor: THEME.colors.surface,
  },
  userText: {
    color: THEME.colors.text,
    fontSize: 16,
    lineHeight: 24,
  },
  assistantMessage: {
    // Stretch rather than shrink-wrap: rich content (tables, code, lists)
    // measures unreliably when the bubble's width depends on its own text, and
    // a stale measurement wraps a reply into a narrow column.
    alignSelf: "stretch",
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
