import { useMemo } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from "react-native";
import Svg, { Polyline } from "react-native-svg";
import type { DocumentHeading } from "./file-content";
import { THEME } from "../styles/theme";

// A small caret that rotates via the `open` flag (points right when closed,
// down when open). Kept local — it's the only place that needs it.
function Caret({ open, color }: { open: boolean; color: string }) {
  return (
    <Svg width={14} height={14} viewBox="0 0 24 24">
      <Polyline
        points={open ? "6 9 12 15 18 9" : "9 6 15 12 9 18"}
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

/**
 * The document title bar. Tapping it toggles a table-of-contents drawer built
 * from the document's headings. Selecting a heading scrolls the editor to it
 * (the parent wires `onSelect` to a platform-specific scroll).
 */
export function DocumentToc({
  title,
  headings,
  open,
  onToggle,
  onSelect,
}: {
  title: string;
  headings: DocumentHeading[];
  open: boolean;
  onToggle: () => void;
  onSelect: (index: number) => void;
}) {
  const hasToc = headings.length > 0;

  // Indent nested headings relative to the shallowest heading present, so a doc
  // whose top level is h2 still starts flush-left.
  const minLevel = useMemo(
    () => (hasToc ? Math.min(...headings.map((h) => h.level)) : 1),
    [headings, hasToc],
  );

  return (
    <View style={styles.wrap}>
      <TouchableOpacity
        style={styles.titleBar}
        activeOpacity={hasToc ? 0.6 : 1}
        onPress={hasToc ? onToggle : undefined}
        accessibilityRole={hasToc ? "button" : undefined}
        accessibilityLabel={hasToc ? "Toggle table of contents" : undefined}
      >
        <Text style={styles.titleText} numberOfLines={1}>
          {title}
        </Text>
        {hasToc ? <Caret open={open} color={THEME.colors.textMuted} /> : null}
      </TouchableOpacity>

      {open && hasToc ? (
        <View style={styles.tocPanel}>
          <ScrollView
            style={styles.tocScroll}
            contentContainerStyle={styles.tocContent}
            keyboardShouldPersistTaps="handled"
          >
            {headings.map((h) => (
              <TouchableOpacity
                key={h.index}
                style={[
                  styles.tocRow,
                  { paddingLeft: THEME.spacing.lg + (h.level - minLevel) * 16 },
                ]}
                activeOpacity={0.6}
                onPress={() => onSelect(h.index)}
              >
                <Text
                  style={[styles.tocText, h.level <= minLevel && styles.tocTextTop]}
                  numberOfLines={1}
                >
                  {h.text}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "relative",
    zIndex: 20,
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.border,
    backgroundColor: THEME.colors.backgroundSecondary,
  },
  titleBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: THEME.spacing.sm,
    paddingHorizontal: THEME.spacing.lg,
    paddingVertical: THEME.spacing.sm,
  },
  titleText: {
    flex: 1,
    fontSize: 17,
    color: THEME.colors.textSecondary,
  },
  // Keep the title bar in the document flow, but float the outline over the
  // document so opening it never shifts the rendered Markdown.
  tocPanel: {
    position: "absolute",
    top: "100%",
    left: 0,
    right: 0,
    zIndex: 21,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: THEME.colors.border,
    backgroundColor: "rgba(255, 255, 255, 0.94)",
    shadowColor: "#0f172a",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.14,
    shadowRadius: 16,
    elevation: 8,
  },
  tocScroll: {
    maxHeight: 260,
  },
  tocContent: {
    paddingVertical: THEME.spacing.sm,
  },
  tocRow: {
    paddingVertical: THEME.spacing.xs + 2,
    paddingRight: THEME.spacing.lg,
  },
  tocText: {
    fontSize: 15,
    color: THEME.colors.textSecondary,
  },
  tocTextTop: {
    color: THEME.colors.text,
    fontWeight: "500",
  },
});
