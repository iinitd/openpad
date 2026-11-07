import { View, Text, StyleSheet } from "react-native";
import { PressableRow } from "../components/PressableRow";
import { Icon } from "../components/Icon";
import { THEME } from "../styles/theme";

// A small floating control pinned to the top of the preview that jumps the
// scroll to the next (or previous) AI-changed block. Only visible when at
// least one block carries the `.kel-changed` tint. The actual scroll + pulse
// happens inside the document shell (`jumpToChangedBlock`); this is just the
// trigger.
export function ChangedBlockCursor({
  count,
  onJumpNext,
  onJumpPrev,
}: {
  count: number;
  onJumpNext: () => void;
  onJumpPrev: () => void;
}) {
  if (count <= 0) return null;
  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.pill}>
        <View style={styles.dot} />
        <Text style={styles.label} numberOfLines={1}>
          {count} AI edit{count === 1 ? "" : "s"}
        </Text>
        <PressableRow
          style={styles.btn}
          onPress={onJumpPrev}
          haptic="light"
          accessibilityLabel="Jump to previous AI edit"
        >
          <View style={styles.btnInner}>
            <Icon name="chevron-up" size={16} color={THEME.colors.text} />
          </View>
        </PressableRow>
        <PressableRow
          style={styles.btn}
          onPress={onJumpNext}
          haptic="light"
          accessibilityLabel="Jump to next AI edit"
        >
          <View style={styles.btnInner}>
            <Icon name="chevron-down" size={16} color={THEME.colors.text} />
          </View>
        </PressableRow>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    top: THEME.spacing.sm,
    right: THEME.spacing.md,
    zIndex: 20,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingLeft: 10,
    paddingRight: 4,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "#ecfdf5",
    borderWidth: 1,
    borderColor: "#86efac",
    shadowColor: "#0f172a",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    backgroundColor: "#22c55e",
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: "#065f46",
  },
  btn: {
    width: 26,
    height: 26,
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.6)",
  },
  btnInner: {
    width: 26,
    height: 26,
    alignItems: "center",
    justifyContent: "center",
  },
});
